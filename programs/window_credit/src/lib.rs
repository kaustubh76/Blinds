//! `window_credit` — loans against encrypted stock collateral.
//!
//! The one piece of new mathematics lives in `lock_collateral`: the program forms
//! `E_Δ = k_c·E_c − k_l·E_ℓ` from the borrower's collateral and loan ciphertexts with curve
//! syscalls, where `k_c = price · multiplier` (public) and `k_l = 150`, and consumes an
//! equality proof plus a 64-bit range proof that `E_Δ` encrypts a non-negative value — i.e.
//! collateral value ≥ 150 % of the loan — without learning either amount (spec v2 §7.3).

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod zk;

use instructions::*;
use state::{InitializeParams, MatchKind};

declare_id!("3C6zwULWtL7oQHcEQbL9myG2zaJ8CPanRvPrF18ifKcr");

pub mod seeds {
    pub const CONFIG: &[u8] = b"config";
    /// `["price", feed_id]`
    pub const PRICE: &[u8] = b"price";
    /// `["loan", epoch_le, borrower, bid_tick, k]`
    pub const LOAN: &[u8] = b"loan";
}

#[program]
pub mod window_credit {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Keeper posts the named Pyth feed's price.
    pub fn post_price(
        ctx: Context<PostPrice>,
        price: u64,
        expo: i32,
        publish_time: i64,
    ) -> Result<()> {
        instructions::post_price::handler(ctx, price, expo, publish_time)
    }

    /// Administrator posts one match of a printed epoch; a full fill copies the bid ciphertext.
    pub fn post_match(ctx: Context<PostMatch>, epoch: u64, k: u8, kind: MatchKind) -> Result<()> {
        instructions::post_match::handler(ctx, epoch, k, kind)
    }

    /// Borrower proves collateral value ≥ 150 % of the loan against the fresh public price.
    pub fn lock_collateral(ctx: Context<LockCollateral>) -> Result<()> {
        instructions::lock_collateral::handler(ctx)
    }

    /// Borrower's confidential transfer into escrow must precede this instruction.
    pub fn deposit_collateral(ctx: Context<DepositCollateral>) -> Result<()> {
        instructions::deposit_collateral::handler(ctx)
    }

    pub fn confirm_lock(ctx: Context<ConfirmLock>) -> Result<()> {
        instructions::lifecycle::confirm_lock(ctx)
    }

    pub fn confirm_funding(ctx: Context<ConfirmFunding>) -> Result<()> {
        instructions::lifecycle::confirm_funding(ctx)
    }

    pub fn repay(ctx: Context<Repay>) -> Result<()> {
        instructions::lifecycle::repay(ctx)
    }

    /// Anyone, once the deadline passed and the price is fresh.
    pub fn seize(ctx: Context<Seize>) -> Result<()> {
        instructions::lifecycle::seize(ctx)
    }

    /// Operator returns (Repaid) or forwards (Defaulted) the collateral; the confidential
    /// transfer out of escrow must precede this instruction.
    pub fn release_collateral(ctx: Context<ReleaseCollateral>) -> Result<()> {
        instructions::release::handler(ctx)
    }
}
