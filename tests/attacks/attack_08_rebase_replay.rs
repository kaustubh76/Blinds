//! A 10:1 split: the mint's multiplier becomes 10 and the per-share price falls to a tenth.
//! The encrypted share count is untouched; the solvency verdict is unchanged; a naive valuation
//! (shares × new price, ignoring the multiplier) would show −90 %.
use window_credit::state::LoanStatus;
use window_proofs::{scalar, ProofError};

use crate::credit_fixture::{matched_loan, USDC};

#[test]
fn ten_for_one_split_leaves_solvency_unchanged_and_naive_valuation_craters() {
    let mut f = matched_loan(200_000 * USDC);
    // Corporate action: multiplier 1.0 → 10.0 on the mint; price $400.12 → $40.012.
    f.h.set_multiplier(&f.setup.mock_mint, 10.0);
    f.h.post_price(&f.setup, 4_001_200_000, -8).unwrap();
    let scalars = f.h.current_scalars(&f.setup, 10.0);
    assert_eq!((scalars.k_c, scalars.k_l), (4_001 * 10_000, 150));

    // Same encrypted 1,000.000 shares, same 200,000 USDC loan: still solvent, lock succeeds.
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
    let l = f.h.loan(&f.loan);
    assert_eq!(l.status, LoanStatus::Requested as u8);
    assert_eq!(
        (l.price_at_lock, l.mult_at_lock),
        (4_001, 10_000),
        "the public scalar records the rebase"
    );

    // The naive integrator: value = shares × price with the multiplier ignored.
    let naive = scalar::solvency_scalars(4_001, 1_000, 15_000).unwrap();
    assert!(matches!(
        scalar::delta(1_000_000, f.loan_size, &naive).ok_or(ProofError::Undercollateralized),
        Err(ProofError::Undercollateralized)
    ));
    let naive_value = scalar::collateral_value_micro(1_000_000, &naive);
    let true_value = scalar::collateral_value_micro(1_000_000, &scalars);
    assert!(naive_value * 10 <= true_value + 1_000_000, "naive valuation shows a ~90% collapse");
}

#[test]
fn a_stale_multiplier_cannot_fake_coverage() {
    // The reverse: a reverse split 1:10 (multiplier 0.1, price ×10). A borrower who could
    // still use the old multiplier would appear 10× richer; the program reads the mint.
    let mut f = matched_loan(200_000 * USDC);
    f.h.set_multiplier(&f.setup.mock_mint, 0.1);
    f.h.post_price(&f.setup, 400_120_000_000, -8).unwrap(); // $4,001.20
    let honest = f.h.current_scalars(&f.setup, 0.1);
    // 1,000.000 "old" shares now represent 100 shares × $4,001.20 = 400,120 USDC: still solvent.
    let (claim, pair) =
        f.h.build_lock_proofs(
            f.borrower,
            &f.h.loan(&f.loan),
            1_000_000,
            f.loan_size,
            &f.bid.opening,
            &honest,
        )
        .unwrap();
    // but proofs built with the *old* multiplier (1.0) bind to a different E_Δ and are rejected
    let stale = scalar::solvency_scalars(400_120, 1_000, 15_000).unwrap();
    let (claim2, pair2) =
        f.h.build_lock_proofs(
            f.borrower,
            &f.h.loan(&f.loan),
            100_000,
            f.loan_size,
            &f.bid.opening,
            &stale,
        )
        .unwrap();
    let err = f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim2, &pair2).unwrap_err();
    assert!(err.has_code("DeltaMismatch"), "{err}");
    f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap();
}
