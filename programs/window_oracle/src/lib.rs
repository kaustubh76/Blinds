//! `window_oracle` — turns a closed epoch's ciphertext accumulators into a proven print.
//!
//! `begin_print` snapshots which ticks are nonzero; `attest_ticks` consumes inline
//! `ZeroCiphertext` proofs bound to the frozen accumulators; `finalize_print` recomputes r*
//! from the attested sums with `window_clearing::clear` and rejects any other claim (spec v2
//! §7.2, §7.5). The administrator supplies nothing the program does not verify.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::TickClaim;

declare_id!("78Z5vNDsujWjDZjKFp625tZ1QMjD44VEHKCFH3LmzfLV");

pub mod seeds {
    pub const ORACLE: &[u8] = b"oracle";
    /// `["print", epoch.to_le_bytes()]`
    pub const PRINT: &[u8] = b"print";
    /// Signer PDA for the `mark_printed` CPI.
    pub const AUTHORITY: &[u8] = b"authority";
}

#[program]
pub mod window_oracle {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        auction_program: Pubkey,
        band_edge_epochs: u8,
        stale_after_slots: u64,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, auction_program, band_edge_epochs, stale_after_slots)
    }

    /// Opens the print for a closed epoch and snapshots its nonzero ticks.
    pub fn begin_print(ctx: Context<BeginPrint>, epoch_index: u64) -> Result<()> {
        instructions::begin_print::handler(ctx, epoch_index)
    }

    /// Attests up to `claims.len()` ticks; claim *i* is bound to the `VerifyZeroCiphertext`
    /// instruction at relative offset `−(len − i)` in this transaction.
    pub fn attest_ticks(
        ctx: Context<AttestTicks>,
        epoch_index: u64,
        claims: Vec<TickClaim>,
    ) -> Result<()> {
        instructions::attest_ticks::handler(ctx, epoch_index, claims)
    }

    /// Recomputes r* from the attested sums; prints only if it equals the claim.
    pub fn finalize_print(
        ctx: Context<FinalizePrint>,
        epoch_index: u64,
        claimed_r_star: Option<u8>,
    ) -> Result<()> {
        instructions::finalize_print::handler(ctx, epoch_index, claimed_r_star)
    }

    /// Anyone, after `stale_after_slots` past close without a finalized print.
    pub fn mark_stale(ctx: Context<MarkStale>, epoch_index: u64) -> Result<()> {
        instructions::mark_stale::handler(ctx, epoch_index)
    }
}
