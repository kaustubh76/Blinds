use window_clearing::Side;

use crate::{closed_epoch_with_print_begun, USDC};

#[test]
fn finalize_with_one_nonzero_tick_unproven_is_rejected() {
    let (mut h, epoch) = closed_epoch_with_print_begun();
    h.attest(epoch, &[(Side::Ask, 8, 1_000 * USDC)]).unwrap();
    let err = h.finalize_print(epoch, Some(8)).unwrap_err();
    assert!(err.has_code("CoverageIncomplete"), "{err}");
    // A claim for a tick nobody bid on is refused too (no proof could bind anyway).
    let err = h.attest(epoch, &[(Side::Ask, 9, 0)]).unwrap_err();
    assert!(err.has_code("TickNotNonzero"), "{err}");
    h.attest(epoch, &[(Side::Bid, 16, 700 * USDC)]).unwrap();
    h.finalize_print(epoch, Some(8)).unwrap();
}
