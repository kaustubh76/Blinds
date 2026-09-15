use window_clearing::Side;

use crate::{closed_epoch_with_print_begun, USDC};

#[test]
fn correct_sums_wrong_rate_is_rejected() {
    let (mut h, epoch) = closed_epoch_with_print_begun();
    h.attest(epoch, &[(Side::Ask, 8, 1_000 * USDC), (Side::Bid, 16, 700 * USDC)]).unwrap();
    for wrong in [Some(9u8), Some(7), None] {
        let err = h.finalize_print(epoch, wrong).unwrap_err();
        assert!(err.has_code("RateMismatch"), "claim {wrong:?}: {err}");
    }
    h.finalize_print(epoch, Some(8)).unwrap();
    let err = h.finalize_print(epoch, Some(8)).unwrap_err();
    assert!(
        err.has_code("NotClosed") || err.has_code("AlreadyFinalized"),
        "a print is final: {err}"
    );
}
