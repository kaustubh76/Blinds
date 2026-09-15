use anchor_lang::prelude::*;
use window_auction::state::{Epoch, EpochStatus};
use window_clearing::regime::{self, Outcome};

use crate::{
    errors::OracleError,
    events::PrintMissed,
    seeds,
    state::{OracleState, Print, PrintStatus},
};

/// Anyone may flag a missed print once the deadline passes; the benchmark carries the last rate
/// as stale. A late `finalize_print` remains possible.
#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct MarkStale<'info> {
    #[account(mut)]
    pub anyone: Signer<'info>,
    #[account(mut, seeds = [seeds::ORACLE], bump = oracle_state.bump)]
    pub oracle_state: Account<'info, OracleState>,
    #[account(
        seeds = [window_auction::seeds::EPOCH, &epoch_index.to_le_bytes()],
        bump = epoch.load()?.bump,
        seeds::program = oracle_state.auction_program,
    )]
    pub epoch: AccountLoader<'info, Epoch>,
    #[account(
        init_if_needed,
        payer = anyone,
        space = Print::SPACE,
        seeds = [seeds::PRINT, &epoch_index.to_le_bytes()],
        bump
    )]
    pub print: AccountLoader<'info, Print>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<MarkStale>, epoch_index: u64) -> Result<()> {
    let epoch = ctx.accounts.epoch.load()?;
    require!(epoch.index == epoch_index, OracleError::EpochIndexMismatch);
    require!(epoch.status() == Some(EpochStatus::Closed), OracleError::NotClosed);
    let state = &mut ctx.accounts.oracle_state;
    let deadline = epoch
        .close_slot
        .checked_add(state.stale_after_slots)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    require!(Clock::get()?.slot >= deadline, OracleError::NotYetStale);

    // Fresh account (admin never began) or an attesting print: either way, flag it once.
    let mut print = match ctx.accounts.print.load_init() {
        Ok(p) => p,
        Err(_) => ctx.accounts.print.load_mut()?,
    };
    if print.status == 0 {
        print.epoch = epoch_index;
        print.bump = ctx.bumps.print;
        // nonzero_bitmap is filled by begin_print; a late begin is not possible on an existing
        // account, so snapshot it here too so a late attest/finalize can proceed.
        for side in 0..2 {
            for tick in 0..window_clearing::TICKS {
                if epoch.bid_count[side][tick] > 0 {
                    crate::state::set_bit(
                        &mut print.nonzero_bitmap,
                        crate::state::bit_index(side, tick),
                    );
                }
            }
        }
    }
    require!(
        matches!(print.status(), None | Some(PrintStatus::Attesting) | Some(PrintStatus::Missed)),
        OracleError::AlreadyFinalized
    );
    require!(print.missed == 0, OracleError::AlreadyFinalized);
    print.missed = 1;
    print.status = PrintStatus::Missed as u8;
    let r = regime::step(state.regime(), Outcome::Missed, state.band_edge_epochs);
    state.set_regime(r);
    print.stale = r.stale;
    print.tau = r.tau;
    emit!(PrintMissed { epoch: epoch_index, tau: r.tau });
    Ok(())
}
