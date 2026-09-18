//! The collateral schedule cannot be crossed: a loan locked under one listing cannot deposit into,
//! be released from, or be seized against another listing's escrow or price.
use solana_keypair::Keypair;
use solana_signer::Signer;
use window_credit::state::LoanStatus;

use crate::credit_fixture::{matched_loan, PRICE_TSLA, USDC};

#[test]
fn a_listings_price_cache_cannot_be_swapped_for_anothers() {
    let mut f = matched_loan(200_000 * USDC);
    let second = f.h.add_listing(&f.setup, [9u8; 32], 20_000, 3_600);
    f.h.post_price(&second, 100_766_000_000, -8).unwrap();
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
    // Listing #0's listing account with the second listing's cache: a genuine cache, but not the
    // PDA of listing #0's feed id — `quote::read_quote` refuses it.
    let mut mixed = f.h.add_listing(&f.setup, [11u8; 32], 15_000, 3_600);
    mixed.listing = f.setup.listing;
    mixed.price_cache = second.price_cache;
    mixed.price_account = second.price_account;
    mixed.mock_mint = f.setup.mock_mint;
    let err = f.h.lock_collateral(&mixed, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("BadPriceAccount"), "{err}");
    // The right pairing locks.
    f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap();
    assert_eq!(f.h.loan(&f.loan).listing, f.setup.listing);
}

#[test]
fn deposit_release_and_seize_are_bound_to_the_loans_listing() {
    let mut f = matched_loan(200_000 * USDC);
    let mut second = f.h.add_listing(&f.setup, [9u8; 32], 20_000, 3_600);
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
    f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap();

    // Deposit into the second listing's escrow, from a second-listing account: WrongListing.
    let mut tokens2 = f.h.onboard_tokens(&second, f.borrower, 5_000_000);
    f.h.wrap(&second, f.borrower, &mut tokens2, 2_000_000).unwrap();
    let err =
        f.h.deposit_collateral(&second, f.borrower, &mut tokens2, &f.loan, 1_000_000).unwrap_err();
    assert!(err.has_code("WrongListing"), "{err}");
    f.h.deposit_collateral(&f.setup, f.borrower, &mut f.tokens, &f.loan, 1_000_000).unwrap();
    f.h.confirm_lock(&f.setup, &f.loan).unwrap();
    f.h.confirm_funding(&f.setup, &f.loan).unwrap();

    // Seize against the second listing's (fresh) price: WrongListing.
    let deadline = f.h.loan(&f.loan).deadline_slot;
    f.h.warp_to_slot(deadline + 1);
    f.h.post_price(&second, 100_766_000_000, -8).unwrap();
    let anyone = Keypair::new();
    f.h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    let err = f.h.seize(&second, &f.loan, &anyone).unwrap_err();
    assert!(err.has_code("WrongListing"), "{err}");
    f.h.post_price(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    f.h.seize(&f.setup, &f.loan, &anyone).unwrap();
    assert_eq!(f.h.loan(&f.loan).status, LoanStatus::Defaulted as u8);

    // Release through the second listing's escrow, to a second-listing account: WrongListing.
    let op = second.operator.insecure_clone();
    let mut escrow2 = std::mem::replace(
        &mut second.escrow,
        f.h.create_confidential_account(&second.cstock_mint, &op),
    );
    // give the second escrow a balance so the transfer itself is well-formed
    let mut t = f.h.onboard_tokens(&second, f.borrower, 1_000_000);
    f.h.wrap(&second, f.borrower, &mut t, 1_000_000).unwrap();
    let wallet = f.h.members[f.borrower].wallet.insecure_clone();
    let (transfer, close) =
        f.h.build_confidential_transfer(
            &mut t.cstock,
            &wallet,
            &second.cstock_mint,
            &escrow2.address,
            1_000_000,
        )
        .unwrap();
    f.h.send(&wallet, &[transfer], &[]).unwrap();
    f.h.close_contexts(&wallet, &close);
    f.h.apply_pending_balance(&mut escrow2, &op, 1_000_000).unwrap();
    second.escrow = escrow2;
    let err =
        f.h.release_collateral(&mut second, &f.loan, &tokens2.cstock.address, 1_000_000)
            .unwrap_err();
    assert!(err.has_code("WrongListing"), "{err}");
}
