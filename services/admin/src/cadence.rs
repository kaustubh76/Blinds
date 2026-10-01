//! How often a thread that has to act *inside a window of slots* should wake.
//!
//! Two threads have this shape. The administrator must attest a repayment between half a loan's
//! tenor and the moment the keeper seizes it; the price poster must repost a cache between half its
//! age limit and the moment the chain refuses it. Both windows are counted in **slots**, and both
//! threads sleep in **milliseconds**, so something has to convert — and the direction of that
//! conversion is the whole problem.
//!
//! A *faster* cluster makes a slot-counted window **shorter** in wall-clock. So the safe assumption
//! is the fastest slot any cluster could produce, not the slowest: assume slow and the computed
//! window is too long, the clamp too loose, and the thread too slow to act inside the real one.
//! Both callers got this backwards and said so in their comments ("400 ms is the slower end …, so
//! this errs toward ticking more often" — it errs the other way). That is the same direction as the
//! bug the administrator's clamp was written to fix: on 24 Sep every loan matured before it could be
//! repaid, the keeper seized it, and tier 2 was red until 30 Sep.
//!
//! `SLOT_MS_FAST` is the lower end of the bracket `app/src/lib/slotTime.ts` already clamps the
//! browser's measured rate to, and below devnet's measured 0.17 s/slot.

/// The fastest slot any cluster we run on could produce. See the module note: fast is the safe end.
pub const SLOT_MS_FAST: u64 = 100;

/// No thread wakes more often than this, however short the window. A tick below it buys nothing —
/// the pass's own duration dominates — and it would put a `getProgramAccounts` scan on a hot loop.
pub const FLOOR_MS: u64 = 250;

/// A chosen cadence, and whether choosing it had to break a promise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cadence {
    pub tick_ms: u64,
    /// The window is so short that `FLOOR_MS` had to win: this profile's window is shorter than the
    /// service can resolve, and the caller should say so rather than imply the invariant holds.
    pub below_floor: bool,
    /// An explicit `WINDOW_*_TICK_MS` was slower than the window allows and was overridden downward.
    pub overrode_operator: bool,
}

/// The tick for a thread that must act at least `divisor` times inside `window_slots`.
///
/// `default_ms` is what the thread would do on a profile whose window is comfortable; the result is
/// never slower than the window allows and never faster than `FLOOR_MS`. An operator's override is
/// honoured downward and clamped upward, because a slower tick is the one that loses the window.
pub fn tick(window_slots: u64, divisor: u64, default_ms: u64, override_ms: Option<u64>) -> Cadence {
    debug_assert!(divisor > 0, "a window must be divided at least once");
    let window_ms = window_slots.saturating_mul(SLOT_MS_FAST);
    let want = window_ms / divisor.max(1);
    let below_floor = want < FLOOR_MS;
    let cap = want.max(FLOOR_MS);
    let asked = override_ms.unwrap_or(default_ms);
    let tick_ms = asked.min(cap);
    Cadence { tick_ms, below_floor, overrode_operator: override_ms.is_some_and(|o| tick_ms < o) }
}

impl Cadence {
    /// One line at startup naming the tick actually used, and a warning whenever choosing it broke
    /// a promise — so a thread that cannot resolve its own window says so instead of looking fine.
    pub fn log(&self, what: &str, window_slots: u64) {
        tracing::info!(what, tick_ms = self.tick_ms, window_slots, "cadence");
        if self.below_floor {
            tracing::warn!(
                what,
                window_slots,
                tick_ms = self.tick_ms,
                floor_ms = FLOOR_MS,
                "this profile's window is shorter than the service can resolve; widen it"
            );
        }
        if self.overrode_operator {
            tracing::warn!(
                what,
                tick_ms = self.tick_ms,
                "the configured tick was slower than the window allows and was clamped down"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Window in slots for each shipped profile: half the tenor for the administrator, half the
    /// tightest listing's age limit for the price poster.
    const ADMIN_WINDOWS: [(&str, u64); 4] =
        [("integration", 60 / 2), ("demo", 150 / 2), ("devnet", 2_700 / 2), ("prod", 54_000 / 2)];

    #[test]
    fn every_profile_gets_at_least_two_chances_at_any_plausible_pace() {
        // The invariant the literals used to stand in for. At any real slot time at or above the
        // fast end, the thread wakes at least `divisor` times inside the true window.
        for (name, window_slots) in ADMIN_WINDOWS {
            let c = tick(window_slots, 2, 10_000, None);
            assert!(!c.below_floor, "{name}: window shorter than the service can resolve");
            for slot_ms in [100, 170, 250, 400, 600, 1_000] {
                let real_window_ms = window_slots * slot_ms;
                assert!(
                    c.tick_ms * 2 <= real_window_ms,
                    "{name} at {slot_ms} ms/slot: tick {} leaves fewer than two chances in {real_window_ms} ms",
                    c.tick_ms
                );
            }
        }
    }

    #[test]
    fn the_clusters_that_cost_real_sol_keep_their_default() {
        // Deliberate literals: "devnet and prod must not poll a shared endpoint faster than they
        // already do" is itself the requirement, so it is asserted as a number, not a property.
        assert_eq!(tick(2_700 / 2, 2, 10_000, None).tick_ms, 10_000, "devnet administrator");
        assert_eq!(tick(54_000 / 2, 2, 10_000, None).tick_ms, 10_000, "prod administrator");
        assert_eq!(tick(1_200 / 2, 2, 20_000, None).tick_ms, 20_000, "devnet price");
        // Prod's price window is tight relative to its tenor (300 slots), so it does tighten — the
        // one place this change makes a thread poll more often, and it is the correct answer.
        assert_eq!(tick(300 / 2, 2, 20_000, None).tick_ms, 7_500, "prod price");
    }

    #[test]
    fn a_longer_window_never_yields_a_shorter_tick() {
        let mut last = 0;
        for w in [1, 5, 15, 30, 75, 600, 1_350, 27_000] {
            let t = tick(w, 2, 10_000, None).tick_ms;
            assert!(t >= last, "window {w} gave {t} after {last}");
            last = t;
        }
    }

    #[test]
    fn an_override_is_honoured_downward_and_clamped_upward_and_says_which() {
        let fast = tick(30, 2, 10_000, Some(200));
        assert_eq!(
            (fast.tick_ms, fast.overrode_operator),
            (200, false),
            "faster than needed is fine"
        );
        let slow = tick(30, 2, 10_000, Some(30_000));
        assert_eq!(slow.tick_ms, 1_500, "slower than the window allows is clamped");
        assert!(slow.overrode_operator, "and the caller is told, so the log is not a lie");
    }

    #[test]
    fn a_window_shorter_than_the_service_can_resolve_reports_itself() {
        // A window under 5 slots is under half a second at the fast end, so half of it is below the
        // floor. The tick is the floor and `below_floor` says the invariant does not hold — rather
        // than returning a number that quietly satisfies nothing.
        let c = tick(4, 2, 10_000, None);
        assert_eq!((c.tick_ms, c.below_floor), (FLOOR_MS, true));
        // INTEGRATION's old 20-slot tenor sat just above it: a 10-slot window resolves at 500 ms,
        // which is why the floor was never what made that profile marginal — a tick that does a
        // `getProgramAccounts` scan and sometimes a whole print cannot reliably run twice in a
        // second. Widening the tenor is the fix; the floor only catches the absurd.
        let was = tick(10, 2, 10_000, None);
        assert_eq!((was.tick_ms, was.below_floor), (500, false));
        let z = tick(0, 2, 10_000, None);
        assert_eq!((z.tick_ms, z.below_floor), (FLOOR_MS, true));
    }

    #[test]
    fn an_absurd_window_neither_overflows_nor_stalls() {
        let c = tick(u64::MAX, 2, 10_000, None);
        assert_eq!(c.tick_ms, 10_000);
        assert!(!c.below_floor);
    }
}
