use solana_keypair::Keypair;
use solana_signer::Signer;
use window_credit::state::LoanStatus;

use crate::credit_fixture::{matched_loan, PRICE_TSLA, USDC};

#[test]
fn stale_price_at_lock_and_at_seize_are_both_rejected() {
    let mut f = matched_loan(200_000 * USDC);
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
    // Lock with a stale price: rejected (inaction).
    f.h.warp(f.h.profile.market.max_price_age_slots + 1);
    let err = f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("PriceStale"), "{err}");
    // Fresh price: the same proofs lock.
    f.h.post_price(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap();
    f.h.deposit_collateral(&f.setup, f.borrower, &mut f.tokens, &f.loan, 1_000_000).unwrap();
    f.h.confirm_lock(&f.setup, &f.loan).unwrap();
    f.h.confirm_funding(&f.setup, &f.loan).unwrap();
    // Seize with a stale price: rejected; with a fresh one after maturity: allowed.
    let deadline = f.h.loan(&f.loan).deadline_slot;
    f.h.warp_to_slot(deadline + f.h.profile.market.max_price_age_slots + 2);
    let anyone = Keypair::new();
    f.h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    let err = f.h.seize(&f.setup, &f.loan, &anyone).unwrap_err();
    assert!(err.has_code("PriceStale"), "{err}");
    f.h.post_price(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    f.h.seize(&f.setup, &f.loan, &anyone).unwrap();
    assert_eq!(f.h.loan(&f.loan).status, LoanStatus::Defaulted as u8);
}

#[test]
fn price_cannot_regress() {
    let mut f = matched_loan(200_000 * USDC);
    let admin = f.h.admin.insecure_clone();
    let ix = anchor_ix_post_price(&f, 1, -8, 0);
    let err = f.h.send(&admin, &[ix], &[]).unwrap_err();
    assert!(err.has_code("PriceRegressed"), "{err}");
}

fn anchor_ix_post_price(
    f: &crate::credit_fixture::Fixture,
    price: u64,
    expo: i32,
    publish_time: i64,
) -> solana_instruction::Instruction {
    use anchor_lang::{InstructionData, ToAccountMetas};
    solana_instruction::Instruction {
        program_id: window_credit::ID,
        accounts: window_credit::accounts::PostPrice {
            keeper: f.h.admin.pubkey(),
            config: f.setup.credit_config,
            listing: f.setup.listing,
            price_cache: f.setup.price_cache,
            system_program: solana_system_interface::program::ID,
        }
        .to_account_metas(None),
        data: window_credit::instruction::PostPrice { price, expo, publish_time }.data(),
    }
}

/// The quote's own timestamp is enforced: a freshly *posted* but old quote cannot lock or seize.
#[test]
fn stale_quote_is_rejected_even_when_freshly_posted() {
    let mut f = matched_loan(200_000 * USDC);
    let limit = f.setup.max_publish_age_secs;
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
    // Time passes without the source publishing; the keeper re-posts the same old quote.
    let published = f.h.unix_timestamp();
    f.h.set_unix_timestamp(published + limit + 1);
    f.h.post_price_at(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1, published).unwrap();
    let err = f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("QuoteStale"), "{err}");
    // At the limit exactly: accepted.
    f.h.set_unix_timestamp(published + limit);
    f.h.post_price_at(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1, published).unwrap();
    f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap();
    f.h.deposit_collateral(&f.setup, f.borrower, &mut f.tokens, &f.loan, 1_000_000).unwrap();
    f.h.confirm_lock(&f.setup, &f.loan).unwrap();
    f.h.confirm_funding(&f.setup, &f.loan).unwrap();
    // Seize: a fresh post of a stale quote is inaction too.
    let deadline = f.h.loan(&f.loan).deadline_slot;
    f.h.warp_to_slot(deadline + 1);
    let now = f.h.unix_timestamp();
    f.h.post_price_at(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1, now - limit - 1).unwrap();
    let anyone = Keypair::new();
    f.h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    let err = f.h.seize(&f.setup, &f.loan, &anyone).unwrap_err();
    assert!(err.has_code("QuoteStale"), "{err}");
    f.h.post_price_at(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1, now).unwrap();
    f.h.seize(&f.setup, &f.loan, &anyone).unwrap();
    assert_eq!(f.h.loan(&f.loan).status, LoanStatus::Defaulted as u8);
}

/// A quote from the future is refused at the post (60 s of skew allowed).
#[test]
fn a_quote_from_the_future_is_refused() {
    let mut f = matched_loan(200_000 * USDC);
    let now = f.h.unix_timestamp();
    let err = f.h.post_price_at(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1, now + 61).unwrap_err();
    assert!(err.has_code("PublishTimeAhead"), "{err}");
    f.h.post_price_at(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1, now + 60).unwrap();
}
