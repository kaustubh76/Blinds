//! `window_registry` — who may participate, and under which ElGamal key.
//!
//! Admission is admin-gated for the hackathon (spec v2 §7.1). The stored `elgamal_pubkey` is
//! what `window_auction` and `window_credit` require a member's grouped ciphertexts to carry.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("3Q49UcynVxvbrV9zw4M9bkMKrsQ2x6YvHtY1tgAjgKpi");

/// PDA seeds.
pub mod seeds {
    /// `Config` PDA.
    pub const CONFIG: &[u8] = b"config";
    /// `Member` PDA: `["member", owner]`.
    pub const MEMBER: &[u8] = b"member";
}

#[program]
pub mod window_registry {
    use super::*;

    /// Creates the registry config; the payer becomes admin.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Admits `owner` with its ElGamal public key.
    pub fn add_member(
        ctx: Context<AddMember>,
        owner: Pubkey,
        elgamal_pubkey: [u8; 32],
        joined_epoch: u64,
    ) -> Result<()> {
        instructions::add_member::handler(ctx, owner, elgamal_pubkey, joined_epoch)
    }

    /// Deactivates a member (its PDA stays so history remains attributable).
    pub fn remove_member(ctx: Context<RemoveMember>) -> Result<()> {
        instructions::remove_member::handler(ctx)
    }

    /// A member rotates its own ElGamal key. Bids already accumulated are unaffected (they carry
    /// the key in force when made).
    pub fn update_elgamal_pubkey(
        ctx: Context<UpdateElgamalPubkey>,
        new_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::update_elgamal_pubkey::handler(ctx, new_pubkey)
    }
}
