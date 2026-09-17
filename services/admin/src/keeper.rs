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

use crate::{chain::read, price::PriceSource, Ctx};

pub fn tick(ctx: &Ctx, price: &mut PriceSource) -> Result<()> {
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
        // a fresh price each epoch
        post_price(ctx, price)?;
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
    // Refresh the price at half the freshness window so credit never sees a stale cache. This is a
    // staleness check, not `slot % period == 0`: the loop samples one slot per tick, and on devnet
    // ~13 slots pass per tick, so a modulo test is usually missed and every lock fails PriceStale.
    let half = (ctx.profile.market.max_price_age_slots / 2).max(1);
    let posted = read::<PriceCache>(chain, &pda::price_cache(&ctx.deployment.feed_id()))?
        .map(|c| c.posted_slot);
    if posted.is_none_or(|p| slot.saturating_sub(p) >= half) {
        post_price(ctx, price)?;
    }
    let loans = load_loans(ctx)?;
    seize_matured(ctx, &loans)?;
    close_settled_bids(ctx, &config, slot, &loans)?;
    ctx.metrics
        .keeper_lamports
        .store(chain.balance(&admin.pubkey()).unwrap_or(0), std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

pub fn post_price(ctx: &Ctx, price: &mut PriceSource) -> Result<()> {
    let now = ctx.chain.unix_timestamp()?;
    let p = price.fetch(now)?;
    let age = p.age_secs(now);
    ctx.metrics.price_publish_age_secs.store(age as u64, std::sync::atomic::Ordering::Relaxed);
    if age > ctx.profile.market.max_price_age_slots as i64 {
        // A slot is ~0.4-0.5 s, so this is a loose "older than the on-chain liveness window" flag;
        // the quote is still posted with its true timestamp so the age stays public.
        warn!(publish_age_secs = age, "posting a quote older than the keeper liveness window");
    }
    info!(price = p.price, expo = p.expo, publish_age_secs = age, "price posted");
    let admin = &ctx.keys.admin;
    ctx.chain.send(
        admin,
        &[ix::post_price(
            &admin.pubkey(),
            &ctx.deployment.feed_id(),
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
            match chain.send(
                &ctx.keys.admin,
                &[ix::seize(&ctx.keys.admin.pubkey(), &key, &ctx.deployment.feed_id())],
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
