use window_clearing::Side;
use window_elgamal::{Ciphertext, Point};
use window_proofs::{ix, pocd};

use crate::{closed_epoch_with_print_begun, USDC};

#[test]
fn false_sum_with_a_proof_for_the_false_sum_is_rejected_by_the_zk_program() {
    let (mut h, epoch) = closed_epoch_with_print_begun();
    // The SDK will not even build a proof for a false statement; an attacker must forge bytes.
    // A tampered proof over the false residual is rejected by the ZK ElGamal Proof program
    // before attest_ticks runs.
    let e = h.epoch(epoch);
    let acc = Ciphertext {
        commitment: Point(e.acc_commitment[1][16]),
        handle: Point(e.acc_handle[1][16]),
    };
    assert!(
        pocd::build(&h.auditor, &acc, 401 * USDC).is_err(),
        "no honest proof exists for a false sum"
    );
    let good = pocd::build(&h.auditor, &acc, 700 * USDC).unwrap();
    let mut forged = good;
    // rewrite the context to the false residual, keep the (now mismatched) proof bytes
    forged.context.ciphertext = bytemuck::cast(acc.residual(401 * USDC).unwrap().to_bytes());
    let attest = h.attest_ix(epoch, &[(Side::Bid, 16, 401 * USDC)]);
    let admin = h.admin.insecure_clone();
    let err = h.send(&admin, &[ix::verify_inline(&forged), attest], &[]).unwrap_err();
    assert!(err.error.contains("InstructionError(0"), "rejected at the proof instruction: {err}");
}

#[test]
fn true_proof_with_a_false_claim_is_rejected_by_binding() {
    let (mut h, epoch) = closed_epoch_with_print_begun();
    let e = h.epoch(epoch);
    let acc = Ciphertext {
        commitment: Point(e.acc_commitment[1][16]),
        handle: Point(e.acc_handle[1][16]),
    };
    let good = pocd::build(&h.auditor, &acc, 700 * USDC).unwrap();
    let attest = h.attest_ix(epoch, &[(Side::Bid, 16, 699 * USDC)]);
    let admin = h.admin.insecure_clone();
    let err = h.send(&admin, &[ix::verify_inline(&good), attest], &[]).unwrap_err();
    assert!(err.has_code("ResidualMismatch"), "{err}");
}
