//! Transaction shape: `[VerifyZeroCiphertext × n, attest_ticks(claims[n])]`.

use anchor_lang::prelude::*;
use bytemuck::bytes_of;
use solana_zk_sdk::zk_elgamal_proof_program::proof_data::{
    ZeroCiphertextProofContext, ZeroCiphertextProofData,
};
use spl_token_confidential_transfer_proof_extraction::instruction::verify_and_extract_context;
use window_auction::state::Epoch;
use window_clearing::{bound_ok, Side, Tick};
use window_elgamal::{Ciphertext, Point};

use crate::{
    errors::OracleError,
    events::TicksAttested,
    seeds,
    state::{bit_index, get_bit, set_bit, OracleState, Print, PrintStatus, TickClaim},
};

/// Hard cap on claims per instruction (transaction size decides the practical batch).
pub const MAX_CLAIMS: usize = 4;

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct AttestTicks<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::ORACLE], bump = oracle_state.bump, has_one = admin @ OracleError::Unauthorized)]
    pub oracle_state: Account<'info, OracleState>,
    #[account(
        seeds = [window_auction::seeds::EPOCH, &epoch_index.to_le_bytes()],
        bump = epoch.load()?.bump,
        seeds::program = oracle_state.auction_program,
    )]
    pub epoch: AccountLoader<'info, Epoch>,
    #[account(mut, seeds = [seeds::PRINT, &epoch_index.to_le_bytes()], bump = print.load()?.bump)]
    pub print: AccountLoader<'info, Print>,
    /// CHECK: the Instructions sysvar, address-checked.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub(crate) fn handler(
    ctx: Context<AttestTicks>,
    epoch_index: u64,
    claims: Vec<TickClaim>,
) -> Result<()> {
    require!(!claims.is_empty() && claims.len() <= MAX_CLAIMS, OracleError::TooManyClaims);
    let epoch = ctx.accounts.epoch.load()?;
    require!(epoch.index == epoch_index, OracleError::EpochIndexMismatch);
    let mut print = ctx.accounts.print.load_mut()?;
    require!(
        matches!(print.status(), Some(PrintStatus::Attesting) | Some(PrintStatus::Missed)),
        OracleError::PrintNotAttesting
    );
    let ix_info = ctx.accounts.instructions.to_account_info();
    let n = claims.len() as i64;
    for (i, claim) in claims.iter().enumerate() {
        let side = Side::from_u8(claim.side).ok_or(OracleError::BadTick)?;
        let tick = Tick::new(claim.tick).ok_or(OracleError::BadTick)?;
        let (s, t) = (side.index(), tick.index());
        let bit = bit_index(s, t);
        require!(get_bit(&print.nonzero_bitmap, bit), OracleError::TickNotNonzero);
        require!(!get_bit(&print.proven_bitmap, bit), OracleError::TickAlreadyAttested);
        require!(bound_ok(claim.sum, epoch.bid_count[s][t]), OracleError::SumExceedsBound);

        // The proof for claim i sits at relative offset −(n − i).
        let empty: &[AccountInfo] = &[];
        let ctx_data: ZeroCiphertextProofContext =
            verify_and_extract_context::<ZeroCiphertextProofData, _>(
                &mut empty.iter(),
                -(n - i as i64),
                Some(&ix_info),
            )
            .map_err(|_| error!(OracleError::WrongProofType))?;
        require!(bytes_of(&ctx_data.pubkey) == epoch.auditor_pubkey, OracleError::ProofKeyMismatch);

        // Bind: the proven ciphertext must be exactly (C_t − sum·G, D_t) from the frozen accumulator.
        let acc = Ciphertext {
            commitment: Point(epoch.acc_commitment[s][t]),
            handle: Point(epoch.acc_handle[s][t]),
        };
        let residual = acc.residual(claim.sum).map_err(|_| error!(OracleError::CurveError))?;
        require!(
            bytes_of(&ctx_data.ciphertext) == residual.to_bytes(),
            OracleError::ResidualMismatch
        );

        print.claimed_sum[s][t] = claim.sum;
        set_bit(&mut print.proven_bitmap, bit);
        print.attested = print.attested.saturating_add(1);
    }
    emit!(TicksAttested { epoch: epoch_index, attested: print.attested });
    Ok(())
}
