//! A matched loan awaiting its lock, shared by attack tests 6–8.
use window_clearing::Side;
use window_testkit::{
    credit::{CreditSetup, MemberTokens},
    Harness,
};

pub const USDC: u64 = 1_000_000;
pub const PRICE_TSLA: (u64, i32) = (40_012_000_000, -8);

pub struct Fixture {
    pub h: Harness,
    pub setup: CreditSetup,
    pub borrower: usize,
    pub tokens: MemberTokens,
    pub loan: solana_pubkey::Pubkey,
    pub bid: window_proofs::bid::BidProofs,
    pub loan_size: u64,
}

pub fn matched_loan(loan_size: u64) -> Fixture {
    let mut h = Harness::new("demo");
    let setup = h.with_credit();
    let borrower = h.add_member();
    let lender = h.add_member();
    let mut tokens = h.onboard_tokens(&setup, borrower, 5_000_000);
    h.wrap(&setup, borrower, &mut tokens, 2_000_000).unwrap();
    let epoch = h.open_epoch();
    let (_, bid) = h.submit_bid_keep(borrower, Side::Bid, 10, loan_size).unwrap();
    h.submit_bid(lender, Side::Ask, 5, 1_000_000 * USDC).unwrap();
    h.close_epoch(epoch);
    h.print_epoch(epoch).unwrap();
    let loan = h.post_match_full(&setup, epoch, borrower, 10, lender, 5, 0).unwrap();
    h.post_price(&setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    Fixture { h, setup, borrower, tokens, loan, bid, loan_size }
}
