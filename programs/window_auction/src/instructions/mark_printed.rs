use anchor_lang::prelude::*;

use crate::{
    errors::AuctionError,
    events::EpochPrinted,
    seeds,
    state::{Config, Epoch, EpochStatus},
};

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct MarkPrinted<'info> {
    /// The oracle program's signer PDA. A CPI caller cannot be identified through the
    /// Instructions sysvar, so the oracle proves itself by signing with this PDA.
    #[account(seeds = [seeds::ORACLE_AUTHORITY], bump, seeds::program = config.oracle_program)]
    pub oracle_authority: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [seeds::EPOCH, &index.to_le_bytes()], bump = epoch.load()?.bump)]
    pub epoch: AccountLoader<'info, Epoch>,
}

pub(crate) fn handler(ctx: Context<MarkPrinted>, index: u64, outcome: u8) -> Result<()> {
    let mut epoch = ctx.accounts.epoch.load_mut()?;
    require!(epoch.index == index, AuctionError::EpochIndexMismatch);
    require!(epoch.status() == Some(EpochStatus::Closed), AuctionError::NotClosed);
    let status = EpochStatus::from_u8(outcome).ok_or(AuctionError::BadOutcome)?;
    require!(status.is_settled(), AuctionError::BadOutcome);
    epoch.status = outcome;
    emit!(EpochPrinted { index, outcome });
    Ok(())
}
