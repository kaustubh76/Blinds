//! The brute-force §7.3 evaluation is the oracle; `clear`/`ask_allocation` must agree on any curve.
use proptest::prelude::*;
use window_clearing::{
    ask_allocation, bound_ok, clear, cumulative, DepthCurve, Ratio, BID_BITS, TICKS,
};

fn brute_force(c: &DepthCurve) -> Option<(usize, u64)> {
    for r in 0..TICKS {
        let s: u64 = (0..=r).map(|t| c.ask[t]).sum();
        let d: u64 = (r..TICKS).map(|t| c.bid[t]).sum();
        if d > 0 && s >= d {
            return Some((r, d));
        }
    }
    None
}

fn sparse_curve() -> impl Strategy<Value = DepthCurve> {
    // Realistic: a handful of ticks populated, sizes below the per-bid bound times a small count.
    let side = prop::collection::vec((0usize..TICKS, 0u64..(1u64 << 44)), 0..8);
    (side.clone(), side).prop_map(|(asks, bids)| {
        let mut c = DepthCurve::default();
        for (t, v) in asks {
            c.ask[t] = c.ask[t].saturating_add(v);
        }
        for (t, v) in bids {
            c.bid[t] = c.bid[t].saturating_add(v);
        }
        c
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn clear_agrees_with_brute_force(c in sparse_curve()) {
        let got = clear(&c).unwrap().map(|cl| (cl.r_star.index(), cl.matched));
        prop_assert_eq!(got, brute_force(&c));
    }

    #[test]
    fn allocation_conserves_volume(c in sparse_curve()) {
        if let Some(cl) = clear(&c).unwrap() {
            let alloc = ask_allocation(&c, &cl).unwrap();
            let m = alloc.marginal_tick.index();
            prop_assert!(m <= cl.r_star.index());
            let full: u64 = (0..m).map(|t| c.ask[t]).sum();
            let at_m = if alloc.marginal_ratio == Ratio::ONE { c.ask[m] } else { alloc.marginal_ratio.num };
            prop_assert_eq!(full + at_m, cl.matched, "filled supply must equal matched demand");
            prop_assert!(alloc.marginal_ratio.num <= alloc.marginal_ratio.den && alloc.marginal_ratio.den > 0);
            let (s, d) = cumulative(&c).unwrap();
            prop_assert!(s[cl.r_star.index()] >= d[cl.r_star.index()]);
            prop_assert_eq!(cl.matched, d[cl.r_star.index()], "bids are always fully filled");
        }
    }

    #[test]
    fn bound_is_exact(n in 0u32..1000, extra in 0u64..(1u64 << 20)) {
        let limit = (n as u64) << BID_BITS;
        prop_assert!(bound_ok(limit, n));
        prop_assert!(!bound_ok(limit + 1 + extra, n) || n == 0 && limit + 1 + extra == 0);
    }
}
