//! `window-admin migrate-loans`: brings every pre-listing `Loan` (32 bytes shorter) to the current
//! layout, bound to listing #0. Batched; safe to re-run (a migrated loan is skipped by its length).

use anyhow::{anyhow, Result};
use solana_signer::Signer;
use tracing::info;
use window_client::{accounts, ix, pda, Loan, LEGACY_LOAN_LEN};

use crate::Ctx;

pub fn run(ctx: &Ctx) -> Result<usize> {
    let chain = ctx.chain.as_ref();
    let admin = &ctx.keys.admin;
    let primary = ctx
        .deployment
        .listings
        .first()
        .ok_or_else(|| anyhow!("no listings recorded — run `listings sync` first"))?;
    let listing = pda::listing(&primary.cstock_mint()?);
    let disc = accounts::discriminator::<Loan>();
    let legacy: Vec<_> = chain
        .program_accounts(&window_client::programs::CREDIT, &disc)?
        .into_iter()
        .filter(|(_, data)| data.len() == LEGACY_LOAN_LEN)
        .map(|(key, _)| key)
        .collect();
    info!(count = legacy.len(), "pre-listing loans to migrate");
    for batch in legacy.chunks(8) {
        let ixs: Vec<_> =
            batch.iter().map(|loan| ix::migrate_loan(&admin.pubkey(), loan, &listing)).collect();
        chain.send(admin, &ixs, &[])?;
        info!(migrated = batch.len(), "batch migrated");
    }
    Ok(legacy.len())
}
