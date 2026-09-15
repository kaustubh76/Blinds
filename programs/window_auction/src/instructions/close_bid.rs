use anchor_lang::prelude::*;

use crate::{
    errors::AuctionError,
    seeds,
    state::{Bid, Config, Epoch},
};

/// Permissionless once the epoch settled and the administrator's matching window
/// (`stale_after_slots` after close) has passed; rent returns to the member.
#[derive(Accounts)]
pub struct CloseBid<'info> {
    pub anyone: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [seeds::EPOCH, &bid.epoch.to_le_bytes()], bump = epoch.load()?.bump)]
    pub epoch: AccountLoader<'info, Epoch>,
    #[account(
        mut,
        close = member,
        seeds = [seeds::BID, &bid.epoch.to_le_bytes(), bid.member.as_ref(), &[bid.side], &[bid.tick]],
        bump = bid.bump,
        has_one = member @ AuctionError::Unauthorized,
    )]
    pub bid: Account<'info, Bid>,
    /// CHECK: receives the rent; must equal `bid.member` (enforced by `has_one`).
    #[account(mut)]
    pub member: UncheckedAccount<'info>,
}

pub(crate) fn handler(ctx: Context<CloseBid>) -> Result<()> {
    let epoch = ctx.accounts.epoch.load()?;
    let status = epoch.status().ok_or(AuctionError::EpochNotSettled)?;
    require!(status.is_settled(), AuctionError::EpochNotSettled);
    let deadline = epoch
        .close_slot
        .checked_add(ctx.accounts.config.stale_after_slots)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    require!(Clock::get()?.slot >= deadline, AuctionError::MatchingWindowOpen);
    Ok(())
}
