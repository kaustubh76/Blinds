//! Spec v2 §16 Phase 2 gate: five scripted members, a full encrypted epoch, ρ = 1, Printed;
//! plus the stale path and rent reclamation.
use solana_keypair::Keypair;
use solana_signer::Signer;
use window_clearing::{clear, DepthCurve, Side};
use window_testkit::Harness;

const USDC: u64 = 1_000_000;

#[test]
fn five_members_full_epoch_prints_with_full_coverage() {
    let mut h = Harness::new("demo");
    let m: Vec<usize> = (0..5).map(|_| h.add_member()).collect();
    let epoch = h.open_epoch();
    // lenders
    h.submit_bid(m[0], Side::Ask, 4, 1_000 * USDC).unwrap();
    h.submit_bid(m[1], Side::Ask, 6, 2_000 * USDC).unwrap();
    h.submit_bid(m[2], Side::Ask, 8, 1_500 * USDC).unwrap();
    // borrowers
    h.submit_bid(m[3], Side::Bid, 12, 2_500 * USDC).unwrap();
    h.submit_bid(m[4], Side::Bid, 7, 700 * USDC).unwrap();
    // a member may bid both sides at different ticks
    h.submit_bid(m[0], Side::Bid, 10, 300 * USDC).unwrap();

    // Cannot close before the window.
    let admin = h.admin.insecure_clone();
    let err = h.close_epoch_as(epoch, &admin).unwrap_err();
    assert!(err.has_code("WindowNotElapsed"), "{err}");
    h.close_epoch(epoch);
    // Bidding after close is rejected.
    let err = h.submit_bid(m[1], Side::Bid, 5, 10 * USDC).unwrap_err();
    assert!(err.has_code("NotOpen"), "{err}");

    let curve = h.decrypt_curve(epoch);
    let mut expect = DepthCurve::default();
    expect.ask[4] = 1_000 * USDC;
    expect.ask[6] = 2_000 * USDC;
    expect.ask[8] = 1_500 * USDC;
    expect.bid[12] = 2_500 * USDC;
    expect.bid[7] = 700 * USDC;
    expect.bid[10] = 300 * USDC;
    assert_eq!(curve, expect);
    let cl = clear(&curve).unwrap().unwrap();
    // D(4)=3500 > S(4)=1000; D(6)=3500 > S(6)=3000; D(7)=3500 > 3000; D(8)=2800 <= S(8)=4500 → r*=8
    assert_eq!(cl.r_star.get(), 8);
    assert_eq!(cl.matched, 2_800 * USDC);

    let out = h.print_epoch(epoch).unwrap();
    assert_eq!(out.r_star_tick, Some(8));
    let p = h.print(epoch).unwrap();
    assert_eq!(p.proven_bitmap, p.nonzero_bitmap, "ρ = 1");
    assert_eq!(p.status, window_oracle::state::PrintStatus::Printed as u8);
    // marginal tick: S(4)=1000 < 2800, S(6)=3000 ≥ 2800 → m=6, ratio 1800/2000
    assert_eq!(p.marginal_tick, 6);
    assert_eq!((p.marginal_ratio_num, p.marginal_ratio_den), (1_800 * USDC, 2_000 * USDC));

    // Rent reclamation is blocked until the matching window passes, then open to anyone.
    let anyone = Keypair::new();
    h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    let member0 = h.members[m[0]].pubkey();
    let err = h.close_bid(epoch, &member0, Side::Ask, 4, &anyone).unwrap_err();
    assert!(err.has_code("MatchingWindowOpen"), "{err}");
    h.warp(h.profile.market.stale_after_slots);
    let before = h.svm.get_balance(&member0).unwrap();
    h.close_bid(epoch, &member0, Side::Ask, 4, &anyone).unwrap();
    assert!(h.svm.get_balance(&member0).unwrap() > before);
    assert!(h.bid(epoch, &member0, Side::Ask, 4).is_none());

    // The next epoch opens and prints against the rate just printed.
    let epoch2 = h.open_epoch();
    h.submit_bid(m[1], Side::Ask, 8, 100 * USDC).unwrap();
    h.submit_bid(m[3], Side::Bid, 9, 100 * USDC).unwrap();
    h.close_epoch(epoch2);
    let out2 = h.print_epoch(epoch2).unwrap();
    assert_eq!(out2.r_star_tick, Some(8));
    let s = h.oracle_state();
    assert_eq!((s.prints, s.last_print_epoch, s.stale, s.tau), (2, epoch2, 0, 0));
}

#[test]
fn no_trade_and_missed_prints_are_stale_and_recoverable() {
    let mut h = Harness::new("demo");
    let a = h.add_member();
    let b = h.add_member();
    // Epoch 0: trade.
    let e0 = h.open_epoch();
    h.submit_bid(a, Side::Ask, 5, 100 * USDC).unwrap();
    h.submit_bid(b, Side::Bid, 9, 100 * USDC).unwrap();
    h.close_epoch(e0);
    h.print_epoch(e0).unwrap();
    // Epoch 1: no overlap → NoTrade, stale carry.
    let e1 = h.open_epoch();
    h.submit_bid(a, Side::Ask, 20, 100 * USDC).unwrap();
    h.submit_bid(b, Side::Bid, 3, 100 * USDC).unwrap();
    h.close_epoch(e1);
    let out = h.print_epoch(e1).unwrap();
    assert_eq!(out.r_star_tick, None);
    let s = h.oracle_state();
    assert_eq!(
        (s.stale, s.tau, s.last_r_star_tick, s.last_print_epoch),
        (1, 1, 5, e0),
        "carries the last trade print, flagged stale"
    );
    assert_eq!(h.epoch(e1).status, window_auction::state::EpochStatus::NoTrade as u8);
    // Epoch 2: administrator goes silent → anyone marks stale after the deadline.
    let e2 = h.open_epoch();
    h.submit_bid(a, Side::Ask, 5, 100 * USDC).unwrap();
    h.close_epoch(e2);
    let anyone = Keypair::new();
    h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    let err = h.mark_stale(e2, &anyone).unwrap_err();
    assert!(err.has_code("NotYetStale"), "{err}");
    h.warp(h.profile.market.stale_after_slots);
    h.mark_stale(e2, &anyone).unwrap();
    let s = h.oracle_state();
    assert_eq!((s.stale, s.tau), (1, 2));
    assert!(h.mark_stale(e2, &anyone).is_err(), "flagged once");
    // The next epoch opens regardless; a late finalize is still possible.
    let e3 = h.open_epoch();
    h.submit_bid(a, Side::Ask, 5, 100 * USDC).unwrap();
    h.submit_bid(b, Side::Bid, 9, 100 * USDC).unwrap();
    h.close_epoch(e3);
    // late print of e2 (one-sided → NoTrade) — attest_ticks after begin is not needed; begin_print is
    // refused because the Print exists, so the admin attests on the stale print directly.
    let curve = h.decrypt_curve(e2);
    h.attest(e2, &[(Side::Ask, 5, curve.ask[5])]).unwrap();
    h.finalize_print(e2, None).unwrap();
    assert_eq!(h.print(e2).unwrap().status, window_oracle::state::PrintStatus::NoTrade as u8);
    // Two consecutive trade prints clear stale.
    h.print_epoch(e3).unwrap();
    assert_eq!(h.oracle_state().stale, 1, "one trade print is not enough");
    let e4 = h.open_epoch();
    h.submit_bid(a, Side::Ask, 5, 100 * USDC).unwrap();
    h.submit_bid(b, Side::Bid, 9, 100 * USDC).unwrap();
    h.close_epoch(e4);
    h.print_epoch(e4).unwrap();
    assert_eq!(h.oracle_state().stale, 0);
}
