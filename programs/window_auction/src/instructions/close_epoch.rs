use anchor_lang::prelude::*;

use crate::{
    errors::AuctionError,
    events::EpochClosed,
    seeds,
    state::{Config, Epoch, EpochStatus},
};

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CloseEpoch<'info> {
    /// Keeper before grace; anyone after.
    pub closer: Signer<'info>,
    #[account(mut, seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [seeds::EPOCH, &index.to_le_bytes()], bump = epoch.load()?.bump)]
    pub epoch: AccountLoader<'info, Epoch>,
}

pub(crate) fn handler(ctx: Context<CloseEpoch>, index: u64) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let mut epoch = ctx.accounts.epoch.load_mut()?;
    require!(epoch.index == index, AuctionError::EpochIndexMismatch);
    let status = epoch.status().ok_or(AuctionError::NotOpen)?;
    if status != EpochStatus::Open {
        // Idempotent: closing twice is a no-op so a keeper and a griefer cannot oscillate.
        return Ok(());
    }
    let slot = Clock::get()?.slot;
    let earliest =
        epoch.start_slot.checked_add(config.epoch_slots).ok_or(ProgramError::ArithmeticOverflow)?;
    require!(slot >= earliest, AuctionError::WindowNotElapsed);
    let grace_end =
        earliest.checked_add(config.keeper_grace_slots).ok_or(ProgramError::ArithmeticOverflow)?;
    if ctx.accounts.closer.key() != config.keeper {
        require!(slot >= grace_end, AuctionError::NotKeeperBeforeGrace);
    }
    epoch.status = EpochStatus::Closed as u8;
    epoch.close_slot = slot;
    config.has_open_epoch = false;
    emit!(EpochClosed { index, close_slot: slot });
    Ok(())
}
