use anchor_lang::prelude::*;

use crate::{
    errors::AuctionError,
    seeds,
    state::{Config, InitializeParams},
};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [seeds::CONFIG], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<Initialize>, p: InitializeParams) -> Result<()> {
    require!(
        p.epoch_slots > 0 && p.stale_after_slots > p.keeper_grace_slots,
        AuctionError::BadParams
    );
    require!(p.auditor_elgamal_pubkey != [0u8; 32], AuctionError::BadParams);
    require!(p.max_bids_per_epoch > 0, AuctionError::BadParams);
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.keeper = p.keeper;
    c.oracle_program = p.oracle_program;
    c.registry_program = p.registry_program;
    c.auditor_elgamal_pubkey = p.auditor_elgamal_pubkey;
    c.cusdc_mint = p.cusdc_mint;
    c.cstock_mint = p.cstock_mint;
    c.epoch_slots = p.epoch_slots;
    c.keeper_grace_slots = p.keeper_grace_slots;
    c.stale_after_slots = p.stale_after_slots;
    c.s_min = p.s_min;
    c.max_bids_per_epoch = p.max_bids_per_epoch;
    c.epochs_opened = 0;
    c.current_epoch = 0;
    c.has_open_epoch = false;
    c.bump = ctx.bumps.config;
    Ok(())
}
