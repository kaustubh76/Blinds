use anchor_lang::prelude::*;
use window_auction::{
    program::WindowAuction,
    state::{Config as AuctionConfig, Epoch, EpochStatus},
};
use window_clearing::{
    ask_allocation, clear,
    regime::{self, Outcome},
    DepthCurve, Tick, TICKS,
};

use crate::{
    errors::OracleError,
    events::{NoTrade, Printed},
    seeds,
    state::{bit_index, get_bit, OracleState, Print, PrintStatus},
};

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct FinalizePrint<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [seeds::ORACLE], bump = oracle_state.bump, has_one = admin @ OracleError::Unauthorized)]
    pub oracle_state: Account<'info, OracleState>,
    #[account(
        mut,
        seeds = [window_auction::seeds::EPOCH, &epoch_index.to_le_bytes()],
        bump = epoch.load()?.bump,
        seeds::program = oracle_state.auction_program,
    )]
    pub epoch: AccountLoader<'info, Epoch>,
    #[account(mut, seeds = [seeds::PRINT, &epoch_index.to_le_bytes()], bump = print.load()?.bump)]
    pub print: AccountLoader<'info, Print>,
    /// CHECK: PDA that signs the `mark_printed` CPI; the auction program verifies its seeds.
    #[account(seeds = [seeds::AUTHORITY], bump)]
    pub oracle_authority: UncheckedAccount<'info>,
    #[account(seeds = [window_auction::seeds::CONFIG], bump = auction_config.bump, seeds::program = oracle_state.auction_program)]
    pub auction_config: Account<'info, AuctionConfig>,
    #[account(address = oracle_state.auction_program)]
    pub auction_program: Program<'info, WindowAuction>,
}

pub(crate) fn handler(
    ctx: Context<FinalizePrint>,
    epoch_index: u64,
    claimed_r_star: Option<u8>,
) -> Result<()> {
    let curve;
    let outcome;
    {
        let epoch = ctx.accounts.epoch.load()?;
        require!(epoch.index == epoch_index, OracleError::EpochIndexMismatch);
        require!(epoch.status() == Some(EpochStatus::Closed), OracleError::NotClosed);
        let mut print = ctx.accounts.print.load_mut()?;
        require!(
            matches!(print.status(), Some(PrintStatus::Attesting) | Some(PrintStatus::Missed)),
            OracleError::AlreadyFinalized
        );
        // Coverage: every nonzero tick proven; zero ticks carry zero.
        require!(print.proven_bitmap == print.nonzero_bitmap, OracleError::CoverageIncomplete);
        let mut c = DepthCurve::default();
        for side in 0..2 {
            for tick in 0..TICKS {
                let v = print.claimed_sum[side][tick];
                if !get_bit(&print.nonzero_bitmap, bit_index(side, tick)) {
                    require!(v == 0, OracleError::CoverageIncomplete);
                }
                if side == 0 {
                    c.ask[tick] = v;
                } else {
                    c.bid[tick] = v;
                }
            }
        }
        curve = c;
        // Recompute. A valid proof set with a wrong rate is rejected here.
        let clearing = clear(&curve).map_err(|_| error!(OracleError::Overflow))?;
        let recomputed = clearing.map(|cl| cl.r_star.get());
        require!(recomputed == claimed_r_star, OracleError::RateMismatch);

        let state = &mut ctx.accounts.oracle_state;
        let slot = Clock::get()?.slot;
        print.finalized_slot = slot;
        match clearing {
            Some(cl) => {
                let alloc =
                    ask_allocation(&curve, &cl).map_err(|_| error!(OracleError::Overflow))?;
                let r =
                    regime::step(state.regime(), Outcome::Trade(cl.r_star), state.band_edge_epochs);
                state.set_regime(r);
                print.status = PrintStatus::Printed as u8;
                print.r_star_tick = cl.r_star.get();
                print.matched_volume = cl.matched;
                print.marginal_tick = alloc.marginal_tick.get();
                print.marginal_ratio_num = alloc.marginal_ratio.num;
                print.marginal_ratio_den = alloc.marginal_ratio.den;
                print.stale = r.stale;
                print.tau = r.tau;
                print.regime_flags = if r.band_edge == 1 { Print::REGIME_BAND_EDGE } else { 0 };
                state.has_printed = true;
                state.last_print_epoch = epoch_index;
                state.last_r_star_tick = cl.r_star.get();
                state.last_matched = cl.matched;
                state.prints = state.prints.saturating_add(1);
                outcome = EpochStatus::Printed;
                emit!(Printed {
                    epoch: epoch_index,
                    r_star_tick: cl.r_star.get(),
                    r_star_bps: Tick::new(cl.r_star.get()).map(|t| t.bps()).unwrap_or(0),
                    matched_volume: cl.matched,
                    stale: r.stale == 1,
                    tau: r.tau,
                });
            }
            None => {
                let r = regime::step(state.regime(), Outcome::NoTrade, state.band_edge_epochs);
                state.set_regime(r);
                print.status = PrintStatus::NoTrade as u8;
                print.stale = r.stale;
                print.tau = r.tau;
                outcome = EpochStatus::NoTrade;
                emit!(NoTrade { epoch: epoch_index, tau: r.tau });
            }
        }
    }

    // Tell the auction. Signed by our PDA — the only proof of who is calling.
    let bump = ctx.bumps.oracle_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[seeds::AUTHORITY, &[bump]]];
    let cpi = CpiContext::new_with_signer(
        ctx.accounts.auction_program.key(),
        window_auction::cpi::accounts::MarkPrinted {
            oracle_authority: ctx.accounts.oracle_authority.to_account_info(),
            config: ctx.accounts.auction_config.to_account_info(),
            epoch: ctx.accounts.epoch.to_account_info(),
        },
        signer_seeds,
    );
    window_auction::cpi::mark_printed(cpi, epoch_index, outcome as u8)?;
    Ok(())
}
