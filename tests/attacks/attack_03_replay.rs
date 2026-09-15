use window_clearing::Side;
use window_elgamal::{Ciphertext, Point};
use window_proofs::{ix, pocd};

use crate::{closed_epoch_with_print_begun, USDC};

#[test]
fn proof_from_another_epoch_or_tick_does_not_bind() {
    let (mut h, e0) = closed_epoch_with_print_begun();
    let acc0 = {
        let e = h.epoch(e0);
        Ciphertext {
            commitment: Point(e.acc_commitment[1][16]),
            handle: Point(e.acc_handle[1][16]),
        }
    };
    let proof_e0 = pocd::build(&h.auditor, &acc0, 700 * USDC).unwrap();
    h.print_epoch(e0).unwrap();

    // Epoch 1 with the same sizes at the same tick: fresh randomness → different accumulator.
    let e1 = h.open_epoch();
    h.submit_bid(0, Side::Ask, 8, 1_000 * USDC).unwrap();
    h.submit_bid(1, Side::Bid, 16, 400 * USDC).unwrap();
    h.submit_bid(2, Side::Bid, 16, 300 * USDC).unwrap();
    h.close_epoch(e1);
    h.begin_print(e1).unwrap();
    let attest = h.attest_ix(e1, &[(Side::Bid, 16, 700 * USDC)]);
    let admin = h.admin.insecure_clone();
    let err = h.send(&admin, &[ix::verify_inline(&proof_e0), attest], &[]).unwrap_err();
    assert!(err.has_code("ResidualMismatch"), "replayed proof: {err}");

    // Same epoch, proof for tick 16 presented for the ask at tick 8.
    let acc1 = {
        let e = h.epoch(e1);
        Ciphertext {
            commitment: Point(e.acc_commitment[1][16]),
            handle: Point(e.acc_handle[1][16]),
        }
    };
    let proof_16 = pocd::build(&h.auditor, &acc1, 700 * USDC).unwrap();
    let attest = h.attest_ix(e1, &[(Side::Ask, 8, 1_000 * USDC)]);
    let err = h.send(&admin, &[ix::verify_inline(&proof_16), attest], &[]).unwrap_err();
    assert!(err.has_code("ResidualMismatch"), "wrong tick: {err}");

    // A tick cannot be attested twice.
    h.attest(e1, &[(Side::Bid, 16, 700 * USDC)]).unwrap();
    let err = h.attest(e1, &[(Side::Bid, 16, 700 * USDC)]).unwrap_err();
    assert!(err.has_code("TickAlreadyAttested"), "{err}");
}
