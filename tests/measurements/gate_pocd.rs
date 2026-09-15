//! THE GATE (spec v2 §16 Phase 1), kept permanently: encrypted bids accumulate on-chain via
//! curve syscalls, the auditor decrypts the aggregate, and one proof-of-correct-decryption per
//! nonzero tick is verified by the ZK ElGamal Proof program and bound to the frozen accumulator
//! before the oracle recomputes and prints the rate.
use window_clearing::Side;
use window_testkit::Harness;

use crate::report::record;

const USDC: u64 = 1_000_000;

#[test]
fn gate_two_bids_one_tick_pocd_print() {
    let mut h = Harness::new("demo");
    let a = h.add_member();
    let b = h.add_member();
    let c = h.add_member();
    let epoch = h.open_epoch();

    let ask = h.submit_bid(a, Side::Ask, 8, 1_000 * USDC).expect("ask");
    let bid1 = h.submit_bid(b, Side::Bid, 16, 400 * USDC).expect("bid 1");
    let bid2 = h.submit_bid(c, Side::Bid, 16, 300 * USDC).expect("bid 2 (same tick → accumulates)");
    eprintln!("submit_bid: create ctx {} CU / {} B; verify range {} CU / {} B; validity+submit {} CU / {} B",
        ask[0].compute_units, ask[0].bytes, ask[1].compute_units, ask[1].bytes, ask[2].compute_units, ask[2].bytes);

    // Nothing decryptable without the auditor key; with it, the aggregate is exact.
    h.close_epoch(epoch);
    let curve = h.decrypt_curve(epoch);
    assert_eq!(curve.ask[8], 1_000 * USDC);
    assert_eq!(curve.bid[16], 700 * USDC);
    let e = h.epoch(epoch);
    assert_eq!(e.bid_count[1][16], 2);

    let out = h.print_epoch(epoch).expect("print");
    assert_eq!(out.r_star_tick, Some(8));
    assert_eq!(out.matched, 700 * USDC);
    assert_eq!(out.nonzero_ticks, 2);
    let attest_tx = out.transactions[1];
    eprintln!(
        "print: {} txs, total {} CU, max {} B; attest_ticks (2 PoCD): {} CU / {} B",
        out.tx_count(),
        out.total_cu(),
        out.max_bytes(),
        attest_tx.compute_units,
        attest_tx.bytes
    );
    assert!(attest_tx.compute_units < 200_000, "attest_ticks must stay far below the CU limit");
    assert!(attest_tx.bytes <= 1232);

    let p = h.print(epoch).unwrap();
    assert_eq!(p.r_star_tick, 8);
    assert_eq!(p.matched_volume, 700 * USDC);
    assert_eq!(p.marginal_tick, 8);
    assert_eq!(
        (p.marginal_ratio_num, p.marginal_ratio_den),
        (700 * USDC, 1_000 * USDC),
        "pro-rata at the marginal tick, disclosed"
    );
    let s = h.oracle_state();
    assert_eq!((s.last_r_star_tick, s.last_matched, s.stale, s.tau), (8, 700 * USDC, 0, 0));
    let e = h.epoch(epoch);
    assert_eq!(e.status, window_auction::state::EpochStatus::Printed as u8);

    record("gate.submit_bid.create_ctx_cu", ask[0].compute_units.into());
    record("gate.submit_bid.verify_range_cu", ask[1].compute_units.into());
    record("gate.submit_bid.verify_range_bytes", ask[1].bytes.into());
    record("gate.submit_bid.validity_and_submit_cu", ask[2].compute_units.into());
    record("gate.submit_bid.validity_and_submit_bytes", ask[2].bytes.into());
    record("gate.print.tx_count", out.tx_count().into());
    record("gate.print.total_cu", out.total_cu().into());
    record("gate.attest_ticks_2.cu", attest_tx.compute_units.into());
    record("gate.attest_ticks_2.bytes", attest_tx.bytes.into());
    let _ = (bid1, bid2);
}
