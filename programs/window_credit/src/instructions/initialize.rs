use anchor_lang::prelude::*;

use crate::{
    errors::CreditError,
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
    require!(p.haircut_bps >= 10_000 && p.haircut_bps.is_multiple_of(100), CreditError::BadParams);
    require!(p.tenor_slots > 0 && p.max_price_age > 0, CreditError::BadParams);
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.operator = p.operator;
    c.keeper = p.keeper;
    c.oracle_program = p.oracle_program;
    c.auction_program = p.auction_program;
    c.registry_program = p.registry_program;
    c.cstock_mint = p.cstock_mint;
    c.mock_mint = p.mock_mint;
    c.escrow_account = p.escrow_account;
    c.feed_id = p.feed_id;
    c.haircut_bps = p.haircut_bps;
    c.max_price_age = p.max_price_age;
    c.tenor_slots = p.tenor_slots;
    c.multiplier_override = p.multiplier_override;
    c.bump = ctx.bumps.config;
    Ok(())
}
