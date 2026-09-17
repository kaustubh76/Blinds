//! Spec v2 §15 attack tests 1–5. Every one must be rejected on-chain with the named error.
mod attack_01_false_sum;
mod attack_02_wrong_rate;
mod attack_03_replay;
mod attack_04_missing_proof;
mod attack_05_malformed_bid;
mod attack_06_undercollateralized;
mod attack_07_stale_price;
mod attack_08_rebase_replay;
mod attack_09_wrong_listing;
mod attack_10_listing_admin;
mod credit_fixture;

use window_clearing::Side;
use window_testkit::Harness;

pub const USDC: u64 = 1_000_000;

/// A closed epoch with ask 1000@8 and bids 400@16 + 300@16 (r* = 8, matched 700), print begun.
pub fn closed_epoch_with_print_begun() -> (Harness, u64) {
    let mut h = Harness::new("demo");
    let a = h.add_member();
    let b = h.add_member();
    let c = h.add_member();
    let epoch = h.open_epoch();
    h.submit_bid(a, Side::Ask, 8, 1_000 * USDC).unwrap();
    h.submit_bid(b, Side::Bid, 16, 400 * USDC).unwrap();
    h.submit_bid(c, Side::Bid, 16, 300 * USDC).unwrap();
    h.close_epoch(epoch);
    h.begin_print(epoch).unwrap();
    (h, epoch)
}
