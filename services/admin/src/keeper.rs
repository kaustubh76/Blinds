//! Epoch clock, price posting, seize scan. Stateless per tick: everything is re-derived from chain.

use anyhow::Result;
use solana_signer::Signer;
use tracing::{info, warn};
use window_client::{accounts, ix, pda, AuctionConfig, EpochStatus, Loan, LoanStatus};

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
    // refresh the price at half the freshness window so credit never sees a stale cache
    if slot % (ctx.profile.market.max_price_age_slots / 2).max(1) == 0 {
        post_price(ctx, price)?;
    }
    seize_matured(ctx)?;
    ctx.metrics
        .keeper_lamports
        .store(chain.balance(&admin.pubkey()).unwrap_or(0), std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

pub fn post_price(ctx: &Ctx, price: &mut PriceSource) -> Result<()> {
    let p = price.fetch(ctx.chain.unix_timestamp()?)?;
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

fn seize_matured(ctx: &Ctx) -> Result<()> {
    let chain = ctx.chain.as_ref();
    let slot = chain.slot()?;
    let disc = accounts::discriminator::<Loan>();
    for (key, data) in chain.program_accounts(&window_client::programs::CREDIT, &disc)? {
        let Some(loan) = accounts::decode::<Loan>(&data) else { continue };
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
