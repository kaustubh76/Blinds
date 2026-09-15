use anchor_lang::prelude::*;

use crate::{
    errors::AuctionError,
    events::EpochOpened,
    seeds,
    state::{Config, Epoch, EpochStatus},
};

#[derive(Accounts)]
pub struct OpenEpoch<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [seeds::CONFIG], bump = config.bump, has_one = keeper @ AuctionError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = keeper,
        space = Epoch::SPACE,
        seeds = [seeds::EPOCH, &config.epochs_opened.to_le_bytes()],
        bump
    )]
    pub epoch: AccountLoader<'info, Epoch>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<OpenEpoch>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.has_open_epoch, AuctionError::PrevEpochStillOpen);
    let index = config.epochs_opened;
    let slot = Clock::get()?.slot;
    let mut epoch = ctx.accounts.epoch.load_init()?;
    epoch.index = index;
    epoch.start_slot = slot;
    epoch.close_slot = 0;
    epoch.auditor_pubkey = config.auditor_elgamal_pubkey;
    epoch.status = EpochStatus::Open as u8;
    epoch.bump = ctx.bumps.epoch;
    // accumulators are zero-initialised = identity points
    config.epochs_opened = index.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    config.current_epoch = index;
    config.has_open_epoch = true;
    emit!(EpochOpened { index, start_slot: slot });
    Ok(())
}
