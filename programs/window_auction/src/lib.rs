//! `window_auction` — the epoch clock and the encrypted order book.
//!
//! Members submit `(side, tick)` publicly with a grouped ciphertext of the size. The program
//! verifies the accompanying proofs, adds the ciphertext into the epoch's per-tick accumulator
//! with curve25519 syscalls, and stores it in a `Bid` account. No size is ever visible to the
//! program, the logs, or anyone but the member and the auditor (spec v2 §7.1, §12).

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod zk;

use instructions::*;
use state::InitializeParams;

declare_id!("HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6");

/// PDA seeds.
pub mod seeds {
    pub const CONFIG: &[u8] = b"config";
    /// `["epoch", index.to_le_bytes()]`
    pub const EPOCH: &[u8] = b"epoch";
    /// `["bid", epoch.to_le_bytes(), member, side, tick]`
    pub const BID: &[u8] = b"bid";
    /// The oracle program's signer PDA: `["authority"]` under `config.oracle_program`.
    pub const ORACLE_AUTHORITY: &[u8] = b"authority";
}

#[program]
pub mod window_auction {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Keeper opens the next epoch; stamps the auditor key in force.
    pub fn open_epoch(ctx: Context<OpenEpoch>) -> Result<()> {
        instructions::open_epoch::handler(ctx)
    }

    /// Slot-gated close; keeper before grace, anyone after. Idempotent.
    pub fn close_epoch(ctx: Context<CloseEpoch>, index: u64) -> Result<()> {
        instructions::close_epoch::handler(ctx, index)
    }

    /// Submit an encrypted bid. The validity proof must be the previous instruction of the
    /// transaction; the range proof must already be verified into `range_ctx`.
    pub fn submit_bid<'info>(
        ctx: Context<'info, SubmitBid<'info>>,
        side: u8,
        tick: u8,
    ) -> Result<()> {
        instructions::submit_bid::handler(ctx, side, tick)
    }

    /// Called by `window_oracle` (PDA-signed CPI) once the print is final.
    pub fn mark_printed(ctx: Context<MarkPrinted>, index: u64, outcome: u8) -> Result<()> {
        instructions::mark_printed::handler(ctx, index, outcome)
    }

    /// Reclaims a bid's rent after the epoch settled and the matching window passed.
    pub fn close_bid(ctx: Context<CloseBid>) -> Result<()> {
        instructions::close_bid::handler(ctx)
    }

    /// Admin rotates the auditor key between epochs.
    pub fn rotate_auditor(ctx: Context<RotateAuditor>, new_pubkey: [u8; 32]) -> Result<()> {
        instructions::rotate_auditor::handler(ctx, new_pubkey)
    }
}
