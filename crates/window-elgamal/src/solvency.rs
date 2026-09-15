//! The two derived quantities the programs check proofs against.

use crate::{
    ciphertext::Ciphertext,
    point::{CurveError, Point},
};

/// `C − s_min·G`: the commitment a bid's range proof must be made over, so that proving
/// `(s − s_min) ∈ [0, 2^40)` proves `s ≥ s_min` (spec §7.1 minimum size).
pub fn shifted_commitment(commitment: &Point, s_min: u64) -> Result<Point, CurveError> {
    commitment.sub(&Point::from_amount(s_min)?)
}

/// The priced solvency ciphertext `E_Δ = k_c·E_c − k_l·E_ℓ` (spec §7.3, amendment A3).
///
/// `E_c` encrypts the collateral share count, `E_ℓ` the loan size, both under the borrower's
/// key. With `k_c = p′·a` (price in cents × milli-multiplier) and `k_l = 150`, `E_Δ` encrypts
/// `Δ = c·p′·a − 150·ℓ`, which is non-negative iff collateral value covers 150 % of the loan.
/// This is the only place the formula exists: the program computes it with syscalls, the
/// prover with dalek, both through this function.
pub fn solvency_delta(collateral: &Ciphertext, k_c: u64, loan: &Ciphertext, k_l: u64) -> Result<Ciphertext, CurveError> {
    collateral.scale(k_c)?.sub(&loan.scale(k_l)?)
}
