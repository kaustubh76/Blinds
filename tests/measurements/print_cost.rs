//! Print cost as a function of book occupancy (nonzero ticks): 1, 10, 37, 74.
use window_clearing::Side;
use window_testkit::Harness;

use crate::report::record;

const USDC: u64 = 1_000_000;

fn fill(h: &mut Harness, members: &[usize], nonzero: usize) -> u64 {
    let epoch = h.open_epoch();
    // Asks on ticks 0.., bids on ticks 36 downwards, alternating sides until `nonzero` ticks.
    let mut placed = 0;
    let mut m = 0;
    let mut ask_t = 0u8;
    let mut bid_t = 36u8;
    while placed < nonzero {
        let (side, tick) = if placed % 2 == 0 {
            let t = ask_t;
            ask_t += 1;
            (Side::Ask, t)
        } else {
            let t = bid_t;
            bid_t = bid_t.saturating_sub(1);
            (Side::Bid, t)
        };
        h.submit_bid(members[m % members.len()], side, tick, 10 * USDC).expect("bid");
        m += 1;
        placed += 1;
    }
    h.close_epoch(epoch);
    epoch
}

#[test]
fn print_cost_by_occupancy() {
    let mut h = Harness::new("demo");
    let members: Vec<usize> = (0..4).map(|_| h.add_member()).collect();
    for nonzero in [1usize, 10, 37, 74] {
        let epoch = fill(&mut h, &members, nonzero);
        let out = h.print_epoch(epoch).expect("print");
        assert_eq!(out.nonzero_ticks, nonzero);
        let attest_max_bytes = out.transactions[1..out.transactions.len() - 1]
            .iter()
            .map(|t| t.bytes)
            .max()
            .unwrap_or(0);
        eprintln!(
            "nonzero={nonzero:2}: {} txs, {} CU total, largest attest tx {} B",
            out.tx_count(),
            out.total_cu(),
            attest_max_bytes
        );
        assert!(attest_max_bytes <= 1232);
        assert_eq!(
            out.tx_count(),
            2 + nonzero.div_ceil(h.profile.print.attest_batch as usize),
            "begin + ceil(n/batch) attests + finalize"
        );
        record(&format!("print_cost.nonzero_{nonzero}.tx_count"), out.tx_count().into());
        record(&format!("print_cost.nonzero_{nonzero}.total_cu"), out.total_cu().into());
        record(&format!("print_cost.nonzero_{nonzero}.max_attest_bytes"), attest_max_bytes.into());
        // Next epoch.
        h.warp(1);
    }
}
