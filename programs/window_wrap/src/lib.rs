//! `window_wrap` — the collateral leg's on-ramp.
//!
//! `wrap` moves mock-xStock into program custody, mints cSTOCK-W 1:1 and CPIs the Token-2022
//! confidential `Deposit`, so the tokens land in the member's *pending* confidential balance
//! (spec v2 §7.1, amendment A4). The amount is visible in this transaction — it is a public
//! token leg, the one line in the leak budget (§12). `unwrap` reverses it after a client-side
//! confidential `Withdraw`. Invariant: `cSTOCK-W.supply == custody.amount == vault.wrapped`.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("E2scxVy7CpoxWQRBXsrSteYBbuEeMu7Q4zXYMM5bvLX3");

pub mod seeds {
    /// `["vault", mock_mint]`
    pub const VAULT: &[u8] = b"vault";
    /// Mint authority of cSTOCK-W.
    pub const MINT_AUTHORITY: &[u8] = b"mint_authority";
}

#[program]
pub mod window_wrap {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Public leg: mock-xStock → custody; cSTOCK-W minted and deposited into the member's
    /// pending confidential balance. The member applies it client-side.
    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        instructions::wrap::handler(ctx, amount)
    }

    /// Burns cSTOCK-W from the member's public balance (after a confidential `Withdraw`) and
    /// releases mock-xStock from custody.
    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        instructions::unwrap::handler(ctx, amount)
    }
}
