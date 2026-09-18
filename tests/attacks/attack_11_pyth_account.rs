//! A `price_source = 4` listing prices from Pyth's own receiver-owned `PriceUpdateV2` account.
//! The program accepts only a fully verified update for the listing's feed, owned by the receiver,
//! inside both freshness limits — and never a `PriceCache` for such a listing, nor a Pyth account
//! for a cache-priced one.
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use window_credit::{
    quote::PYTH_RECEIVER,
    state::{LoanStatus, PRICE_SOURCE_PYTH_ACCOUNT},
};
use window_testkit::credit::CreditSetup;

use crate::credit_fixture::{matched_loan, Fixture, PRICE_TSLA, USDC};

const FEED: [u8; 32] = [0x47u8; 32];
/// $1,007.66 with expo −8.
const PYTH_PRICE: i64 = 100_766_000_000;

/// A matched loan plus a source-4 listing the borrower has wrapped collateral on.
fn pyth_fixture() -> (Fixture, CreditSetup, window_testkit::credit::MemberTokens) {
    let mut f = matched_loan(200_000 * USDC);
    let pyth =
        f.h.add_listing_with_source(&f.setup, FEED, 20_000, 3_600, PRICE_SOURCE_PYTH_ACCOUNT);
    assert_eq!(f.h.listing(&pyth.listing).price_source, PRICE_SOURCE_PYTH_ACCOUNT);
    assert_ne!(pyth.price_account, pyth.price_cache);
    let mut tokens = f.h.onboard_tokens(&pyth, f.borrower, 5_000_000);
    f.h.wrap(&pyth, f.borrower, &mut tokens, 2_000_000).unwrap();
    (f, pyth, tokens)
}

fn write_pyth(
    f: &mut Fixture,
    pyth: &CreditSetup,
    owner: &Pubkey,
    feed: &[u8; 32],
    full: bool,
    age: i64,
) {
    let now = f.h.unix_timestamp();
    let slot = f.h.slot();
    f.h.set_pyth_account(&pyth.price_account, owner, feed, PYTH_PRICE, -8, now - age, slot, full);
}

fn proofs(
    f: &Fixture,
    pyth: &CreditSetup,
) -> (window_proofs::solvency::CollateralClaim, window_proofs::solvency::SolvencyProofs) {
    let scalars = f.h.scalars_for(pyth, PYTH_PRICE as u64, -8, 1.0);
    assert_eq!((scalars.k_c, scalars.k_l), (100_766_000, 200));
    // 400.000 shares × $1,007.66 = 403,064 ≥ 200 % × 200,000.
    f.h.build_lock_proofs(
        f.borrower,
        &f.h.loan(&f.loan),
        400_000,
        f.loan_size,
        &f.bid.opening,
        &scalars,
    )
    .unwrap()
}

#[test]
fn a_fully_verified_receiver_owned_update_locks_and_seizes() {
    let (mut f, pyth, mut tokens) = pyth_fixture();
    write_pyth(&mut f, &pyth, &PYTH_RECEIVER, &FEED, true, 30);
    let (claim, pair) = proofs(&f, &pyth);
    f.h.lock_collateral(&pyth, f.borrower, &f.loan, &claim, &pair).unwrap();
    let l = f.h.loan(&f.loan);
    assert_eq!((l.k_c, l.k_l, l.listing), (100_766_000, 200, pyth.listing));
    // No PriceCache was ever created for this listing.
    assert!(f.h.svm.get_account(&window_testkit::addr(&pyth.price_cache)).is_none());

    f.h.deposit_collateral(&pyth, f.borrower, &mut tokens, &f.loan, 400_000).unwrap();
    f.h.confirm_lock(&pyth, &f.loan).unwrap();
    f.h.confirm_funding(&pyth, &f.loan).unwrap();
    assert_eq!(f.h.loan(&f.loan).status, LoanStatus::Active as u8);

    // Seize after maturity: the Pyth account must be fresh by both rules, then it is accepted.
    let deadline = f.h.loan(&f.loan).deadline_slot;
    f.h.warp_to_slot(deadline + f.h.profile.market.max_price_age_slots + 2);
    let anyone = Keypair::new();
    f.h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    let err = f.h.seize(&pyth, &f.loan, &anyone).unwrap_err();
    assert!(err.has_code("PriceStale"), "{err}");
    write_pyth(&mut f, &pyth, &PYTH_RECEIVER, &FEED, true, 5);
    f.h.seize(&pyth, &f.loan, &anyone).unwrap();
    assert_eq!(f.h.loan(&f.loan).status, LoanStatus::Defaulted as u8);
}

#[test]
fn an_update_not_owned_by_the_receiver_is_refused() {
    let (mut f, pyth, _) = pyth_fixture();
    write_pyth(&mut f, &pyth, &Keypair::new().pubkey(), &FEED, true, 30);
    let (claim, pair) = proofs(&f, &pyth);
    let err = f.h.lock_collateral(&pyth, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("BadPriceAccount"), "{err}");
    // Owned by the credit program itself (as a PriceCache would be): still not a Pyth account.
    write_pyth(&mut f, &pyth, &window_credit::ID, &FEED, true, 30);
    let err = f.h.lock_collateral(&pyth, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("BadPriceAccount"), "{err}");
}

#[test]
fn a_partially_verified_update_is_refused() {
    let (mut f, pyth, _) = pyth_fixture();
    write_pyth(&mut f, &pyth, &PYTH_RECEIVER, &FEED, false, 30);
    let (claim, pair) = proofs(&f, &pyth);
    let err = f.h.lock_collateral(&pyth, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("BadPriceAccount"), "{err}");
}

#[test]
fn another_feeds_update_is_refused() {
    let (mut f, pyth, _) = pyth_fixture();
    write_pyth(&mut f, &pyth, &PYTH_RECEIVER, &[0x16u8; 32], true, 30);
    let (claim, pair) = proofs(&f, &pyth);
    let err = f.h.lock_collateral(&pyth, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("WrongFeed"), "{err}");
}

#[test]
fn a_stale_pyth_quote_is_refused_by_the_listings_limit() {
    let (mut f, pyth, _) = pyth_fixture();
    write_pyth(&mut f, &pyth, &PYTH_RECEIVER, &FEED, true, 3_601);
    let (claim, pair) = proofs(&f, &pyth);
    let err = f.h.lock_collateral(&pyth, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("QuoteStale"), "{err}");
    // At the limit exactly: accepted.
    write_pyth(&mut f, &pyth, &PYTH_RECEIVER, &FEED, true, 3_600);
    f.h.lock_collateral(&pyth, f.borrower, &f.loan, &claim, &pair).unwrap();
}

#[test]
fn a_price_cache_cannot_stand_in_for_a_pyth_account_listing() {
    let (mut f, mut pyth, _) = pyth_fixture();
    // The keeper posts a cache for this feed (the instruction does not care about the source)…
    f.h.post_price(&pyth, PYTH_PRICE as u64, -8).unwrap();
    let (claim, pair) = proofs(&f, &pyth);
    // …but a source-4 listing will not price from it.
    pyth.price_account = pyth.price_cache;
    let err = f.h.lock_collateral(&pyth, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("BadPriceAccount"), "{err}");
}

#[test]
fn a_pyth_account_cannot_stand_in_for_a_price_cache_listing() {
    let mut f = matched_loan(200_000 * USDC);
    // Listing #0 (mock source) given a genuine-looking receiver-owned update for its own feed id.
    let feed = f.setup.feed_id;
    let fake = Keypair::new().pubkey();
    let now = f.h.unix_timestamp();
    let slot = f.h.slot();
    f.h.set_pyth_account(
        &fake,
        &PYTH_RECEIVER,
        &feed,
        PRICE_TSLA.0 as i64,
        PRICE_TSLA.1,
        now,
        slot,
        true,
    );
    let scalars = f.h.current_scalars(&f.setup, 1.0);
    let (claim, pair) =
        f.h.build_lock_proofs(
            f.borrower,
            &f.h.loan(&f.loan),
            1_000_000,
            f.loan_size,
            &f.bid.opening,
            &scalars,
        )
        .unwrap();
    let cache = f.setup.price_account;
    f.setup.price_account = fake;
    let err = f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("BadPriceAccount"), "{err}");
    // The cache PDA itself still locks.
    f.setup.price_account = cache;
    f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap();
}
