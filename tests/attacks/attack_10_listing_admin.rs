//! Listing management is admin-only and validated; the migration refuses anything but a
//! pre-listing loan bound to the original collateral.
use solana_keypair::Keypair;
use solana_signer::Signer;
use window_credit::state::ListingParams;

use crate::credit_fixture::{matched_loan, USDC};

fn params(setup: &window_testkit::credit::CreditSetup) -> ListingParams {
    let mut p = setup.listing_params();
    p.max_price_age = 1_200;
    p
}

#[test]
fn only_the_admin_lists_or_retunes_and_params_are_validated() {
    let mut f = matched_loan(200_000 * USDC);
    let stranger = Keypair::new();
    f.h.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let admin = f.h.admin.insecure_clone();

    // A stranger cannot retune.
    let err = f.h.update_listing(&stranger, &f.setup, params(&f.setup)).unwrap_err();
    assert!(err.has_code("Unauthorized"), "{err}");
    // The admin can, within bounds.
    let mut p = params(&f.setup);
    p.haircut_bps = 9_900;
    assert!(f.h.update_listing(&admin, &f.setup, p).unwrap_err().has_code("BadParams"));
    let mut p = params(&f.setup);
    p.haircut_bps = 15_050;
    assert!(f.h.update_listing(&admin, &f.setup, p).unwrap_err().has_code("BadParams"));
    let mut p = params(&f.setup);
    p.max_publish_age_secs = 0;
    assert!(f.h.update_listing(&admin, &f.setup, p).unwrap_err().has_code("BadParams"));
    let mut p = params(&f.setup);
    p.price_source = 4;
    assert!(f.h.update_listing(&admin, &f.setup, p).unwrap_err().has_code("BadParams"));
    let mut p = params(&f.setup);
    p.haircut_bps = 17_500;
    p.max_publish_age_secs = 900;
    p.feed_id = [1u8; 32]; // ignored: the feed id is fixed
    f.h.update_listing(&admin, &f.setup, p).unwrap();
    let l = f.h.listing(&f.setup.listing);
    assert_eq!((l.haircut_bps, l.max_publish_age_secs, l.feed_id), (17_500, 900, f.setup.feed_id));

    // A stranger cannot list, even with a well-formed escrow.
    let second = f.h.add_listing(&f.setup, [9u8; 32], 20_000, 3_600);
    let cstock3 = f.h.create_confidential_mint(&window_testkit::pda::wrap_mint_authority(), 3);
    let mock3 = f.h.create_mock_xstock_mint(3, 1.0);
    let op = f.setup.operator.insecure_clone();
    let escrow3 = f.h.create_confidential_account(&cstock3, &op);
    let err =
        f.h.try_add_listing(&stranger, &mock3, &cstock3, &escrow3.address, params(&second))
            .unwrap_err();
    assert!(err.has_code("Unauthorized"), "{err}");
    // The admin cannot list with an escrow the operator does not own.
    let escrow_wrong = f.h.create_confidential_account(&cstock3, &stranger);
    let err =
        f.h.try_add_listing(&admin, &mock3, &cstock3, &escrow_wrong.address, params(&second))
            .unwrap_err();
    assert!(err.has_code("ConstraintTokenOwner"), "{err}");
    // Nor with the mints swapped (the escrow's mint must be the cSTOCK mint).
    let err =
        f.h.try_add_listing(&admin, &cstock3, &mock3, &escrow3.address, params(&second))
            .unwrap_err();
    assert!(err.has_code("ConstraintTokenMint"), "{err}");
    // Nor twice.
    f.h.try_add_listing(&admin, &mock3, &cstock3, &escrow3.address, params(&second)).unwrap();
    assert!(f
        .h
        .try_add_listing(&admin, &mock3, &cstock3, &escrow3.address, params(&second))
        .is_err());
}

#[test]
fn migration_is_admin_only_and_bound_to_the_original_collateral() {
    use anchor_lang::Discriminator as _;
    let mut f = matched_loan(200_000 * USDC);
    let admin = f.h.admin.insecure_clone();
    let stranger = Keypair::new();
    f.h.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let mut acc = f.h.svm.get_account(&window_testkit::addr(&f.loan)).unwrap();
    acc.data.truncate(window_credit::state::LEGACY_LOAN_LEN);
    assert_eq!(&acc.data[..8], window_credit::state::Loan::DISCRIMINATOR);
    let legacy = Keypair::new().pubkey();
    f.h.svm.set_account(window_testkit::addr(&legacy), acc).unwrap();

    let err = f.h.migrate_loan(&stranger, &f.setup, &legacy).unwrap_err();
    assert!(err.has_code("Unauthorized"), "{err}");
    // A listing other than the one mirroring Config's collateral is refused.
    let second = f.h.add_listing(&f.setup, [9u8; 32], 20_000, 3_600);
    let err = f.h.migrate_loan(&admin, &second, &legacy).unwrap_err();
    assert!(err.has_code("WrongListing"), "{err}");
    // Not a loan (a listing account has the wrong discriminator and length).
    let err = f.h.migrate_loan(&admin, &f.setup, &second.listing).unwrap_err();
    assert!(err.has_code("BadParams"), "{err}");
    f.h.migrate_loan(&admin, &f.setup, &legacy).unwrap();
    assert_eq!(f.h.loan(&legacy).listing, f.setup.listing);
}
