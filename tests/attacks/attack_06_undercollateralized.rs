use solana_zk_sdk::{
    encryption::pedersen::Pedersen, zk_elgamal_proof_program::build_batched_range_proof_u64_data,
};
use window_credit::state::LoanStatus;
use window_elgamal::{encrypt, GroupedCiphertext2};
use window_proofs::{
    bid,
    solvency::{self, SolvencyInputs, SolvencyProofs},
    ProofError,
};

use crate::credit_fixture::{matched_loan, USDC};

#[test]
fn undercollateralized_borrower_cannot_construct_the_proof_pair() {
    let f = matched_loan(200_000 * USDC);
    let scalars = f.h.current_scalars(&f.setup, 1.0);
    // 500.000 shares × $400.12 = 200,060 USDC < 150% × 200,000 = 300,000.
    let err =
        f.h.build_lock_proofs(
            f.borrower,
            &f.h.loan(&f.loan),
            500_000,
            f.loan_size,
            &f.bid.opening,
            &scalars,
        )
        .err()
        .expect("no valid proof exists");
    assert!(matches!(err, ProofError::Undercollateralized));
}

#[test]
fn proof_over_a_smaller_loan_ciphertext_is_rejected_by_delta_binding() {
    let mut f = matched_loan(200_000 * USDC);
    let scalars = f.h.current_scalars(&f.setup, 1.0);
    // The borrower proves solvency against a *fake* loan ciphertext of 100 USDC instead of its
    // real 200,000 USDC bid. The equality proof is valid for E_Δ' but E_Δ' ≠ the program's E_Δ.
    let fake =
        bid::build(&f.h.members[f.borrower].elgamal, &f.h.auditor.pubkey_bytes(), 100 * USDC, USDC)
            .unwrap();
    let claim = solvency::build_collateral(
        &f.h.members[f.borrower].elgamal,
        &f.h.auditor.pubkey_bytes(),
        500_000,
    )
    .unwrap();
    let ec = claim.ciphertext.to_ciphertext(0).unwrap();
    let el_fake = fake.ciphertext.to_ciphertext(0).unwrap();
    let inputs = SolvencyInputs {
        collateral: &ec,
        c: 500_000,
        c_opening: &claim.opening,
        loan: &el_fake,
        l: 100 * USDC,
        l_opening: &fake.opening,
    };
    let pair = solvency::build(&f.h.members[f.borrower].elgamal, &inputs, &scalars).unwrap();
    let err = f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("DeltaMismatch"), "{err}");
    assert_eq!(f.h.loan(&f.loan).status, LoanStatus::Pending as u8);
}

#[test]
fn range_proof_over_another_commitment_is_rejected() {
    let mut f = matched_loan(200_000 * USDC);
    let scalars = f.h.current_scalars(&f.setup, 1.0);
    let (claim, good) =
        f.h.build_lock_proofs(
            f.borrower,
            &f.h.loan(&f.loan),
            1_000_000,
            f.loan_size,
            &f.bid.opening,
            &scalars,
        )
        .unwrap();
    // Valid equality proof, but the 64-bit range proof covers some other commitment.
    let (other, o) = Pedersen::new(1u64);
    let range =
        build_batched_range_proof_u64_data(vec![&other], vec![1], vec![64], vec![&o]).unwrap();
    let pair =
        SolvencyProofs { delta_commitment: good.delta_commitment, equality: good.equality, range };
    let err = f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("DeltaRangeMismatch"), "{err}");
}

#[test]
fn collateral_claim_under_the_wrong_keys_is_rejected() {
    let mut f = matched_loan(200_000 * USDC);
    let scalars = f.h.current_scalars(&f.setup, 1.0);
    // An impostor key for everything: a valid claim and a valid pair (over a fake loan
    // ciphertext under the impostor key), so the ZK program accepts every proof and the
    // *program's* key check is what rejects it.
    let impostor = window_elgamal::keys::Keypair::random();
    let claim =
        solvency::build_collateral(&impostor, &f.h.auditor.pubkey_bytes(), 1_000_000).unwrap();
    let fake_loan = bid::build(&impostor, &f.h.auditor.pubkey_bytes(), f.loan_size, USDC).unwrap();
    let ec = claim.ciphertext.to_ciphertext(0).unwrap();
    let el = fake_loan.ciphertext.to_ciphertext(0).unwrap();
    let inputs = SolvencyInputs {
        collateral: &ec,
        c: 1_000_000,
        c_opening: &claim.opening,
        loan: &el,
        l: f.loan_size,
        l_opening: &fake_loan.opening,
    };
    let pair = solvency::build(&impostor, &inputs, &scalars).unwrap();
    let err = f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("MemberKeyMismatch"), "{err}");
    let _ = (encrypt::Opening::random(), GroupedCiphertext2::default());
}
