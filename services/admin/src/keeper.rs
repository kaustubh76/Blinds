//! Epoch clock, price posting, seize scan. Stateless per tick: everything is re-derived from chain.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::Result;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use tracing::{info, warn};
use window_clearing::Side;
use window_client::{
    accounts, ix, pda, AuctionConfig, Bid, EpochStatus, Loan, LoanStatus, PriceCache,
};

use crate::{chain::read, deployment::ListingRecord, price::PriceSource, Ctx};

/// One price source per listing, in `deployment.listings` order.
pub type PriceSources = Vec<PriceSource>;

pub fn tick(ctx: &Ctx, prices: &mut PriceSources) -> Result<()> {
    let chain = ctx.chain.as_ref();
    let admin = &ctx.keys.admin;
    let slot = chain.slot()?;
    let Some(config) = read::<AuctionConfig>(chain, &pda::auction_config())? else { return Ok(()) };

    if !config.has_open_epoch {
        // open the next epoch unless the previous one is still Closed and unprinted for long — the
        // spec says the next opens regardless; the administrator handles late prints.
        let index = config.epochs_opened;
        chain.send(admin, &[ix::open_epoch(&admin.pubkey(), index)], &[])?;
        ctx.metrics.epochs_opened.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        info!(epoch = index, slot, "epoch opened");
        // a fresh price for every listing each epoch
        post_prices(ctx, prices, slot, true)?;
    } else {
        let e = chain
            .account_data(&pda::epoch(config.current_epoch))?
            .and_then(|d| accounts::decode_epoch(&d));
        if let Some(e) = e {
            if e.status == EpochStatus::Open as u8 && slot >= e.start_slot + config.epoch_slots {
                chain.send(admin, &[ix::close_epoch(&admin.pubkey(), e.index)], &[])?;
                ctx.metrics.epochs_closed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                info!(epoch = e.index, slot, "epoch closed");
            }
        }
    }
    // Refresh each listing's price at half its freshness window so credit never sees a stale
    // cache. This is a staleness check, not `slot % period == 0`: the loop samples one slot per
    // tick, and on devnet ~13 slots pass per tick, so a modulo test is usually missed and every
    // lock fails PriceStale.
    post_prices(ctx, prices, slot, false)?;
    let loans = load_loans(ctx)?;
    seize_matured(ctx, &loans)?;
    close_settled_bids(ctx, &config, slot, &loans)?;
    ctx.metrics
        .keeper_lamports
        .store(chain.balance(&admin.pubkey()).unwrap_or(0), std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Posts every listing whose cache is missing or older than half its `max_price_age`
/// (`force` posts all). One listing's failure never stops the others — nor the rest of the
/// keeper's tick: it is logged, and the chain's freshness rules speak for the missing post.
pub fn post_prices(ctx: &Ctx, prices: &mut PriceSources, slot: u64, force: bool) -> Result<()> {
    let chain = ctx.chain.as_ref();
    for (rec, price) in ctx.deployment.listings.iter().zip(prices.iter_mut()) {
        if rec.reads_pyth_account() {
            // Pyth's receiver writes this listing's quote (via `services/pyth-poster`); the keeper
            // only reports its age.
            match crate::quote::read_quote(chain, rec) {
                Ok(Some(q)) => {
                    let age = chain.unix_timestamp()?.saturating_sub(q.publish_time);
                    ctx.metrics.set_publish_age(&rec.symbol, age as u64);
                    if age > rec.max_publish_age_secs {
                        warn!(listing = %rec.symbol, publish_age_secs = age, limit = rec.max_publish_age_secs, "the Pyth account on this cluster is older than the listing's limit; is the poster running?");
                    }
                }
                Ok(None) => {
                    warn!(listing = %rec.symbol, "the Pyth account on this cluster does not exist yet; is the poster running?")
                }
                Err(e) => warn!(listing = %rec.symbol, "Pyth account unreadable: {e:#}"),
            }
            continue;
        }
        let half = (rec.max_price_age_slots / 2).max(1);
        let posted =
            read::<PriceCache>(chain, &pda::price_cache(&rec.feed_id()))?.map(|c| c.posted_slot);
        if force || posted.is_none_or(|p| slot.saturating_sub(p) >= half) {
            if let Err(e) = post_price(ctx, rec, price) {
                warn!(listing = %rec.symbol, "price post failed: {e:#}");
            }
        }
    }
    Ok(())
}

pub fn post_price(ctx: &Ctx, rec: &ListingRecord, price: &mut PriceSource) -> Result<()> {
    let now = ctx.chain.unix_timestamp()?;
    let p = price.fetch(now)?;
    let age = p.age_secs(now);
    ctx.metrics.set_publish_age(&rec.symbol, age as u64);
    if let (Some(read), Some(url)) = (price.last_mark_read(), price.mark_url()) {
        // The implied price never goes on chain; `/marks` serves it beside the mark for the basis.
        let basis_bps = read
            .implied
            .map(|i| ((i as i128 - read.mark as i128) * 10_000 / read.mark.max(1) as i128) as i64);
        ctx.metrics.set_mark(crate::metrics::MarkSnapshot {
            key: rec.key.clone(),
            symbol: rec.symbol.clone(),
            source: rec.source.clone(),
            feed_id_hex: rec.feed_id_hex.clone(),
            url: url.to_string(),
            mark_e8: read.mark,
            implied_e8: read.implied,
            basis_bps,
            fetched_at: read.fetched_at,
        });
    }
    if age > rec.max_publish_age_secs {
        // Posted anyway, with its true timestamp: the chain refuses to lock or seize on it, and the
        // age stays public. Silently skipping would hide the outage.
        warn!(listing = %rec.symbol, publish_age_secs = age, limit = rec.max_publish_age_secs, "posting a quote older than the listing's on-chain limit");
    }
    info!(listing = %rec.symbol, price = p.price, expo = p.expo, publish_age_secs = age, "price posted");
    let admin = &ctx.keys.admin;
    ctx.chain.send(
        admin,
        &[ix::post_price(
            &admin.pubkey(),
            &rec.listing_pda()?,
            &rec.feed_id(),
            p.price,
            p.expo,
            p.publish_time,
        )],
        &[],
    )?;
    ctx.metrics.prices_posted.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Every loan on chain, read once per tick and shared by the scans below.
fn load_loans(ctx: &Ctx) -> Result<Vec<(Pubkey, Loan)>> {
    let disc = accounts::discriminator::<Loan>();
    Ok(ctx
        .chain
        .program_accounts(&window_client::programs::CREDIT, &disc)?
        .into_iter()
        .filter_map(|(key, data)| accounts::decode::<Loan>(&data).map(|l| (key, l)))
        .collect())
}

fn seize_matured(ctx: &Ctx, loans: &[(Pubkey, Loan)]) -> Result<()> {
    let chain = ctx.chain.as_ref();
    let slot = chain.slot()?;
    for (key, loan) in loans.iter().map(|(k, l)| (*k, l)) {
        if loan.status == LoanStatus::Active as u8 && slot > loan.deadline_slot {
            let Some(rec) = ctx.deployment.listing_by_pda(&loan.listing) else {
                warn!(loan = %key, listing = %loan.listing, "loan bound to an unknown listing; not seizing");
                continue;
            };
            match chain.send(
                &ctx.keys.admin,
                &[ix::seize(
                    &ctx.keys.admin.pubkey(),
                    &key,
                    &rec.listing_pda()?,
                    &rec.quote_account()?,
                )],
                &[],
            ) {
                Ok(_) => {
                    ctx.metrics.seizes.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    info!(loan = %key, "seized (matured, price fresh)");
                }
                Err(e) => warn!(loan = %key, "seize failed: {e}"),
            }
        }
    }
    Ok(())
}

/// Permissionless `close_bid` for bids whose epoch has settled and whose matching window has
/// passed: the rent (0.001438 SOL on devnet) goes back to the member, which is what keeps the
/// simulated agents solvent over a long run. The keeper pays only the fee.
fn close_settled_bids(
    ctx: &Ctx,
    config: &AuctionConfig,
    slot: u64,
    loans: &[(Pubkey, Loan)],
) -> Result<()> {
    const PER_TX: usize = 8;
    let chain = ctx.chain.as_ref();
    let admin = &ctx.keys.admin;
    let disc = accounts::discriminator::<Bid>();
    let bids: Vec<Bid> = chain
        .program_accounts(&window_client::programs::AUCTION, &disc)?
        .into_iter()
        .filter_map(|(_, data)| accounts::decode::<Bid>(&data))
        .collect();
    // One epoch read per distinct epoch, not per bid: on a public devnet RPC the N+1 version is a
    // rate-limit generator.
    // A borrower still needs its own bid ciphertext to prove solvency for a full fill, so a bid is
    // off limits while any loan of that member in that epoch is still Pending. Reclaiming its rent
    // early would strand the loan.
    let pending: BTreeSet<(u64, Pubkey)> = loans
        .iter()
        .filter(|(_, l)| l.status == LoanStatus::Pending as u8)
        .map(|(_, l)| (l.epoch, l.borrower))
        .collect();
    let mut settled: BTreeMap<u64, bool> = BTreeMap::new();
    let mut closable = Vec::new();
    for bid in bids {
        if pending.contains(&(bid.epoch, bid.member)) {
            continue;
        }
        let ok = match settled.get(&bid.epoch) {
            Some(v) => *v,
            None => {
                let v = chain
                    .account_data(&pda::epoch(bid.epoch))?
                    .and_then(|d| accounts::decode_epoch(&d))
                    .is_some_and(|e| {
                        let done = e.status == EpochStatus::Printed as u8
                            || e.status == EpochStatus::NoTrade as u8;
                        done && e.close_slot > 0
                            && slot >= e.close_slot.saturating_add(config.stale_after_slots)
                    });
                settled.insert(bid.epoch, v);
                v
            }
        };
        if !ok {
            continue;
        }
        let side = if bid.side == Side::Bid as u8 { Side::Bid } else { Side::Ask };
        closable.push(ix::close_bid(&admin.pubkey(), bid.epoch, &bid.member, side, bid.tick));
    }
    for chunk in closable.chunks(PER_TX) {
        match chain.send(admin, chunk, &[]) {
            Ok(_) => {
                ctx.metrics
                    .bids_closed
                    .fetch_add(chunk.len() as u64, std::sync::atomic::Ordering::Relaxed);
                info!(bids = chunk.len(), "settled bids closed; rent returned to members");
            }
            Err(e) => warn!("close_bid batch failed: {e:#}"),
        }
    }
    Ok(())
}
