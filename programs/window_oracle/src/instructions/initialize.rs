use anchor_lang::prelude::*;

use crate::{seeds, state::OracleState};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + OracleState::INIT_SPACE, seeds = [seeds::ORACLE], bump)]
    pub oracle_state: Account<'info, OracleState>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(
    ctx: Context<Initialize>,
    auction_program: Pubkey,
    band_edge_epochs: u8,
    stale_after_slots: u64,
) -> Result<()> {
    let s = &mut ctx.accounts.oracle_state;
    s.admin = ctx.accounts.admin.key();
    s.auction_program = auction_program;
    s.band_edge_epochs = band_edge_epochs.max(1);
    s.stale_after_slots = stale_after_slots;
    s.bump = ctx.bumps.oracle_state;
    Ok(())
}
