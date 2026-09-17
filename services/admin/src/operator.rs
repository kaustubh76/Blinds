//! The operator: confirms deposits, applies the escrow's pending balance, and returns/forwards
//! collateral with a confidential transfer the program introspects.

use anyhow::{anyhow, Result};
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use tracing::{info, warn};
use window_client::{accounts, ct, ix, Loan, LoanStatus};
use window_elgamal::{bsgs::Solver, GroupedCiphertext2};

use crate::Ctx;

pub fn tick(ctx: &Ctx, solver: &Solver) -> Result<()> {
    let chain = ctx.chain.as_ref();
    let admin = &ctx.keys.admin;
    let disc = accounts::discriminator::<Loan>();
    for (key, data) in chain.program_accounts(&window_client::programs::CREDIT, &disc)? {
        let Some(loan) = accounts::decode::<Loan>(&data) else { continue };
        let status = loan.status;
        if status == LoanStatus::Deposited as u8 {
            chain.send(admin, &[ix::confirm_lock(&admin.pubkey(), &key)], &[])?;
            ctx.metrics.locks_confirmed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            info!(loan = %key, "lock confirmed");
        } else if (status == LoanStatus::Repaid as u8 || status == LoanStatus::Defaulted as u8)
            && !loan.collateral_released
        {
            if let Err(e) = release(ctx, solver, &key, &loan) {
                warn!(loan = %key, "release failed: {e:#}");
            }
        }
    }
    Ok(())
}

fn release(ctx: &Ctx, solver: &Solver, key: &Pubkey, loan: &Loan) -> Result<()> {
    let chain = ctx.chain.as_ref();
    let admin = &ctx.keys.admin;
    let rec = ctx
        .deployment
        .listing_by_pda(&loan.listing)
        .ok_or_else(|| anyhow!("loan bound to unknown listing {}", loan.listing))?;
    let listing = rec.listing_pda()?;
    let escrow: Pubkey = rec.escrow()?;
    let cstock: Pubkey = rec.cstock_mint()?;
    let ekeys = ctx.keys.escrow();
    let auditor = ctx.keys.auditor();
    // The operator learns the pledged amount from the auditor handle of the collateral claim.
    let ct_c = GroupedCiphertext2::from_bytes(&loan.collateral_ct)
        .to_ciphertext(1)
        .ok_or_else(|| anyhow!("handles"))?;
    let amount = solver
        .decrypt(&auditor, &ct_c, 1u64 << 32)
        .ok_or_else(|| anyhow!("collateral did not decrypt"))?;
    let to_owner =
        if loan.status == LoanStatus::Repaid as u8 { loan.borrower } else { loan.lender };
    let dest = chain
        .token_accounts(&to_owner, &cstock)?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("destination has no cSTOCK-W account"))?;
    // Apply any pending credits first so the available balance covers the release.
    let state =
        ct::confidential_state(&chain.account_data(&escrow)?.ok_or_else(|| anyhow!("escrow"))?)
            .ok_or_else(|| anyhow!("escrow ext"))?;
    let (mut available, pending) =
        ct::balances(&state, &ekeys).ok_or_else(|| anyhow!("escrow balances"))?;
    if pending > 0 {
        chain.send(
            admin,
            &[ct::apply_pending_balance(
                &escrow,
                &admin.pubkey(),
                &state,
                &ekeys,
                available + pending,
            )],
            &[],
        )?;
        available += pending;
    }
    let state =
        ct::confidential_state(&chain.account_data(&escrow)?.ok_or_else(|| anyhow!("escrow"))?)
            .ok_or_else(|| anyhow!("escrow ext"))?;
    let dest_state =
        ct::confidential_state(&chain.account_data(&dest)?.ok_or_else(|| anyhow!("dest"))?)
            .ok_or_else(|| anyhow!("dest ext"))?;
    let dest_pk = dest_state.elgamal_pubkey.try_into().map_err(|_| anyhow!("dest key"))?;
    let rent = |space: usize| chain.rent(space).unwrap_or(0);
    let plan = ct::transfer_plan(
        &admin.pubkey(),
        &escrow,
        &state,
        &ekeys,
        available,
        &cstock,
        &dest,
        &dest_pk,
        Some(auditor.pubkey()),
        amount,
        &rent,
    )
    .map_err(|e| anyhow!(e))?;
    for tx in &plan.setup {
        chain.send(admin, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
    }
    chain.send(
        admin,
        &[plan.transfer, ix::release_collateral(&admin.pubkey(), key, &listing, &dest)],
        &[],
    )?;
    chain.send(admin, &plan.close, &[])?;
    ctx.metrics.releases.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    info!(loan = %key, to = %to_owner, "collateral released");
    Ok(())
}
