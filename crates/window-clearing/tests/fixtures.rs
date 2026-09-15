//! Every fixture is hand-computed from the §7.3 definition; the same JSON drives the TS SDK tests.
use std::collections::BTreeMap;

use serde::Deserialize;
use window_clearing::{ask_allocation, clear, DepthCurve, Ratio, Tick, TICKS};

#[derive(Deserialize)]
struct File {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    name: String,
    asks: BTreeMap<String, u64>,
    bids: BTreeMap<String, u64>,
    expect: Option<Expect>,
}
#[derive(Deserialize)]
struct Expect {
    r_star: u8,
    matched: u64,
    marginal_tick: u8,
    marginal_ratio: [u64; 2],
}

fn curve(asks: &BTreeMap<String, u64>, bids: &BTreeMap<String, u64>) -> DepthCurve {
    let mut c = DepthCurve::default();
    for (t, v) in asks {
        c.ask[t.parse::<usize>().unwrap()] = *v;
    }
    for (t, v) in bids {
        c.bid[t.parse::<usize>().unwrap()] = *v;
    }
    c
}

#[test]
fn fixtures_match_the_spec_definition() {
    let text = include_str!("../fixtures/clearing.json");
    let file: File = serde_json::from_str(text).unwrap();
    assert!(file.cases.len() >= 10);
    for case in file.cases {
        let c = curve(&case.asks, &case.bids);
        let got = clear(&c).unwrap();
        match (got, case.expect) {
            (None, None) => {}
            (Some(cl), Some(e)) => {
                assert_eq!(cl.r_star, Tick::new(e.r_star).unwrap(), "{}: r*", case.name);
                assert_eq!(cl.matched, e.matched, "{}: matched", case.name);
                let alloc = ask_allocation(&c, &cl).unwrap();
                assert_eq!(
                    alloc.marginal_tick,
                    Tick::new(e.marginal_tick).unwrap(),
                    "{}: marginal tick",
                    case.name
                );
                assert_eq!(
                    alloc.marginal_ratio,
                    Ratio { num: e.marginal_ratio[0], den: e.marginal_ratio[1] },
                    "{}: marginal ratio",
                    case.name
                );
            }
            (got, want) => panic!(
                "{}: got {:?}, expected {}",
                case.name,
                got,
                want.map(|e| e.r_star).map_or("no trade".into(), |r| format!("r*={r}"))
            ),
        }
    }
}

#[test]
fn tick_math() {
    assert_eq!(Tick::MIN.bps(), 100);
    assert_eq!(Tick::MAX.bps(), 1000);
    assert_eq!(Tick::new(TICKS as u8), None);
    assert!(
        Tick::MIN.is_band_edge()
            && Tick::MAX.is_band_edge()
            && !Tick::new(1).unwrap().is_band_edge()
    );
}
