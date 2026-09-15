use anchor_lang::prelude::*;
use window_auction::state::{Epoch, EpochStatus};
use window_clearing::TICKS;
use window_elgamal::Point;

use crate::{
    errors::OracleError,
    events::PrintBegun,
    seeds,
    state::{bit_index, set_bit, OracleState, Print, PrintStatus},
};

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct BeginPrint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::ORACLE], bump = oracle_state.bump, has_one = admin @ OracleError::Unauthorized)]
    pub oracle_state: Account<'info, OracleState>,
    /// The closed epoch (owned by `window_auction`; Anchor checks the owner).
    #[account(
        seeds = [window_auction::seeds::EPOCH, &epoch_index.to_le_bytes()],
        bump = epoch.load()?.bump,
        seeds::program = oracle_state.auction_program,
    )]
    pub epoch: AccountLoader<'info, Epoch>,
    #[account(init, payer = admin, space = Print::SPACE, seeds = [seeds::PRINT, &epoch_index.to_le_bytes()], bump)]
    pub print: AccountLoader<'info, Print>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<BeginPrint>, epoch_index: u64) -> Result<()> {
    let epoch = ctx.accounts.epoch.load()?;
    require!(epoch.index == epoch_index, OracleError::EpochIndexMismatch);
    require!(epoch.status() == Some(EpochStatus::Closed), OracleError::NotClosed);
    let mut print = ctx.accounts.print.load_init()?;
    print.epoch = epoch_index;
    print.status = PrintStatus::Attesting as u8;
    print.bump = ctx.bumps.print;
    let mut nonzero = 0u8;
    for side in 0..2 {
        for tick in 0..TICKS {
            let identity = Point(epoch.acc_commitment[side][tick]).is_identity()
                && Point(epoch.acc_handle[side][tick]).is_identity();
            if epoch.bid_count[side][tick] == 0 {
                // The identity shortcut (spec §7.2): a zero-count tick needs no proof, but it
                // must genuinely be empty.
                require!(identity, OracleError::ZeroTickNotIdentity);
            } else {
                set_bit(&mut print.nonzero_bitmap, bit_index(side, tick));
                nonzero = nonzero.saturating_add(1);
            }
        }
    }
    emit!(PrintBegun { epoch: epoch_index, nonzero_ticks: nonzero });
    Ok(())
}
