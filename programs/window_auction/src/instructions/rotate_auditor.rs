use anchor_lang::prelude::*;

use crate::{errors::AuctionError, events::AuditorRotated, seeds, state::Config};

#[derive(Accounts)]
pub struct RotateAuditor<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ AuctionError::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub(crate) fn handler(ctx: Context<RotateAuditor>, new_pubkey: [u8; 32]) -> Result<()> {
    require!(new_pubkey != [0u8; 32], AuctionError::BadParams);
    let config = &mut ctx.accounts.config;
    require!(!config.has_open_epoch, AuctionError::EpochOpen);
    config.auditor_elgamal_pubkey = new_pubkey;
    emit!(AuditorRotated { epochs_opened: config.epochs_opened });
    Ok(())
}
