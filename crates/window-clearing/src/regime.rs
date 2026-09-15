//! Controlled decay / hysteresis (spec §7.5–§7.6): the only implementation of how a print
//! outcome moves the benchmark's `stale`, `tau` and `BandEdge` state.

use bytemuck::{Pod, Zeroable};

use crate::Tick;

/// Persistent regime state, laid out for zero-copy storage in the oracle's state account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Pod, Zeroable)]
#[cfg_attr(feature = "std", derive(serde::Serialize, serde::Deserialize))]
#[repr(C)]
pub struct State {
    /// `1` when the carried rate comes from a no-trade or missed print (§7.6 "stale carry").
    pub stale: u8,
    /// Consecutive trade prints since the last stale event; clears `stale` at 2.
    pub consecutive_trades: u8,
    /// Consecutive prints at a band edge (tick 0 or 36).
    pub edge_streak: u8,
    /// Consecutive prints strictly inside the band.
    pub interior_streak: u8,
    /// `1` while the BandEdge flag is raised. Flag only; no auto-recentering.
    pub band_edge: u8,
    /// Padding for a clean 8-byte layout.
    pub _pad: u8,
    /// Epochs since the last trade print (§7.3 τ).
    pub tau: u16,
}

/// What the finalizer observed for an epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// A rate was printed.
    Trade(Tick),
    /// Curves did not cross.
    NoTrade,
    /// The administrator did not finalize within `stale_after_slots`.
    Missed,
}

/// Number of consecutive trade prints required to clear `stale` (§7.6).
pub const TRADES_TO_CLEAR_STALE: u8 = 2;

/// Applies one outcome. Pure and total: the oracle program stores the returned state verbatim.
pub const fn step(s: State, outcome: Outcome, band_edge_epochs: u8) -> State {
    let mut n = s;
    match outcome {
        Outcome::Trade(tick) => {
            n.tau = 0;
            n.consecutive_trades = n.consecutive_trades.saturating_add(1);
            if n.stale == 1 && n.consecutive_trades >= TRADES_TO_CLEAR_STALE {
                n.stale = 0;
            }
            if tick.is_band_edge() {
                n.edge_streak = n.edge_streak.saturating_add(1);
                n.interior_streak = 0;
                if n.edge_streak >= band_edge_epochs {
                    n.band_edge = 1;
                }
            } else {
                n.interior_streak = n.interior_streak.saturating_add(1);
                n.edge_streak = 0;
                if n.interior_streak >= band_edge_epochs {
                    n.band_edge = 0;
                }
            }
        }
        Outcome::NoTrade | Outcome::Missed => {
            n.stale = 1;
            n.tau = n.tau.saturating_add(1);
            n.consecutive_trades = 0;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_thin_epoch_cannot_flap_the_benchmark() {
        let s = step(State::default(), Outcome::NoTrade, 5);
        assert_eq!((s.stale, s.tau), (1, 1));
        let s = step(s, Outcome::Trade(Tick::new(8).unwrap()), 5);
        assert_eq!(s.stale, 1, "one trade print is not enough to clear stale");
        assert_eq!(s.tau, 0);
        let s = step(s, Outcome::Trade(Tick::new(8).unwrap()), 5);
        assert_eq!(s.stale, 0, "two consecutive trade prints clear stale");
    }

    #[test]
    fn band_edge_sets_and_clears_symmetrically() {
        let mut s = State::default();
        for _ in 0..5 {
            s = step(s, Outcome::Trade(Tick::MAX), 5);
        }
        assert_eq!(s.band_edge, 1);
        for _ in 0..4 {
            s = step(s, Outcome::Trade(Tick::new(10).unwrap()), 5);
            assert_eq!(s.band_edge, 1, "clears only after the same count interior");
        }
        s = step(s, Outcome::Trade(Tick::new(10).unwrap()), 5);
        assert_eq!(s.band_edge, 0);
    }

    #[test]
    fn missed_print_counts_as_stale_and_resets_trade_streak() {
        let s = step(State::default(), Outcome::Trade(Tick::MIN), 5);
        let s = step(s, Outcome::Missed, 5);
        assert_eq!((s.stale, s.tau, s.consecutive_trades), (1, 1, 0));
    }
}
