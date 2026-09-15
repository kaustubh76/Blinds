//! Units and bounds of the priced solvency check (spec v2 §7.3, amendment A3).
//!
//! ```text
//!   c   collateral in milli-shares            (range-proven  < 2^COLLATERAL_BITS)
//!   ℓ   loan in micro-USDC                    (range-proven  < 2^BID_BITS)
//!   p′  price in cents per share              = ⌊price · 10^(expo + PRICE_EXP)⌋
//!   a   multiplier in thousandths             = round(multiplier · 10^MULT_EXP)
//!   V   collateral value in micro-USDC        = c·p′·a / 100
//!   requirement  V ≥ haircut · ℓ / 10^4   ⇔   c·p′·a ≥ (haircut/100)·ℓ
//!   k_c = p′·a,   k_l = haircut_bps / 100   (150 for the 150 % haircut)
//!   Δ   = k_c·c − k_l·ℓ  ≥ 0  proven as a u64 range proof on a commitment to Δ
//! ```

/// Bits of the collateral range proof.
pub const COLLATERAL_BITS: u32 = 32;
/// Bits of the bid/loan range proof.
pub const BID_BITS: u32 = 40;
/// Price is scaled to cents.
pub const PRICE_EXP: i32 = 2;
/// Multiplier is scaled to thousandths.
pub const MULT_EXP: u32 = 3;
/// `k·2^bits` must stay below this so that `Δ` cannot wrap.
pub const SCALAR_BOUND_BITS: u32 = 63;
/// Multiplier upper bound after scaling (a 16,000× rebase is absurd; this keeps `k_c` small).
pub const MULT_MAX_SCALED: u64 = 1 << 24;

/// The two public scalars of a lock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SolvencyScalars {
    /// Multiplies the collateral ciphertext.
    pub k_c: u64,
    /// Multiplies the loan ciphertext.
    pub k_l: u64,
}

/// `⌊price · 10^(expo + PRICE_EXP)⌋`, or `None` on overflow / absurd exponent.
pub const fn price_scaled(price: u64, expo: i32) -> Option<u64> {
    let shift = expo + PRICE_EXP;
    if shift >= 0 {
        if shift > 18 {
            return None;
        }
        let mut v = price;
        let mut i = 0;
        while i < shift {
            v = match v.checked_mul(10) {
                Some(x) => x,
                None => return None,
            };
            i += 1;
        }
        Some(v)
    } else {
        let mut v = price;
        let mut i = 0;
        while i < -shift {
            v /= 10;
            i += 1;
        }
        Some(v)
    }
}

/// `round(multiplier · 10^MULT_EXP)`, or `None` if not finite, ≤ 0, or above [`MULT_MAX_SCALED`].
pub fn multiplier_scaled(multiplier: f64) -> Option<u64> {
    if !multiplier.is_finite() || multiplier <= 0.0 {
        return None;
    }
    // no_std-safe rounding (f64::round is std-only): truncate after adding one half.
    let scaled = multiplier * 1_000.0 + 0.5;
    if scaled < 1.0 || scaled >= MULT_MAX_SCALED as f64 {
        return None;
    }
    Some(scaled as u64)
}

/// `(k_c, k_l)` for a price in cents, a multiplier in thousandths and a haircut in bps.
/// `None` if `haircut_bps` is not a multiple of 100 or anything overflows.
pub const fn solvency_scalars(
    price_cents: u64,
    mult_scaled: u64,
    haircut_bps: u64,
) -> Option<SolvencyScalars> {
    if !haircut_bps.is_multiple_of(100)
        || haircut_bps < 10_000
        || price_cents == 0
        || mult_scaled == 0
    {
        return None;
    }
    match price_cents.checked_mul(mult_scaled) {
        Some(k_c) => Some(SolvencyScalars { k_c, k_l: haircut_bps / 100 }),
        None => None,
    }
}

/// The soundness bound: `k_c·2^COLLATERAL_BITS < 2^63` and `k_l·2^BID_BITS < 2^63`.
pub const fn scalar_bound_ok(s: &SolvencyScalars) -> bool {
    let kc = (s.k_c as u128) << COLLATERAL_BITS;
    let kl = (s.k_l as u128) << BID_BITS;
    kc < (1u128 << SCALAR_BOUND_BITS) && kl < (1u128 << SCALAR_BOUND_BITS)
}

/// The prover's `Δ`. `None` means undercollateralized (no valid proof exists).
pub const fn delta(c: u64, l: u64, s: &SolvencyScalars) -> Option<u64> {
    let lhs = (s.k_c as u128) * (c as u128);
    let rhs = (s.k_l as u128) * (l as u128);
    if lhs < rhs {
        return None;
    }
    let d = lhs - rhs;
    if d > u64::MAX as u128 {
        None
    } else {
        Some(d as u64)
    }
}

/// Collateral value in micro-USDC (for UI and tests, not used in proofs).
pub const fn collateral_value_micro(c: u64, s: &SolvencyScalars) -> u128 {
    (s.k_c as u128) * (c as u128) / 100
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tsla_like_numbers() {
        // Pyth: price 40012000000, expo -8  -> $400.12 -> 40012 cents
        assert_eq!(price_scaled(40_012_000_000, -8), Some(40_012));
        assert_eq!(multiplier_scaled(1.0), Some(1_000));
        assert_eq!(multiplier_scaled(10.0), Some(10_000), "10:1 split");
        let s = solvency_scalars(40_012, 1_000, 15_000).unwrap();
        assert_eq!(s, SolvencyScalars { k_c: 40_012_000, k_l: 150 });
        assert!(scalar_bound_ok(&s));
        // 1,000.000 shares, 200,000 USDC loan: value 400,120 USDC >= 300,000 -> solvent
        assert!(delta(1_000_000, 200_000_000_000, &s).is_some());
        assert_eq!(collateral_value_micro(1_000_000, &s), 400_120_000_000);
        // 300,000 USDC loan: 150% = 450,000 > 400,120 -> undercollateralized
        assert_eq!(delta(1_000_000, 300_000_000_000, &s), None);
    }

    #[test]
    fn rebase_invariance() {
        // 10:1 split: shares ×10 in the world, but the ciphertext (c) is untouched; price ÷10.
        let before = solvency_scalars(40_012, 1_000, 15_000).unwrap();
        let after = solvency_scalars(4_001, 10_000, 15_000).unwrap();
        let (c, l) = (1_000_000, 200_000_000_000);
        assert_eq!(delta(c, l, &before).is_some(), delta(c, l, &after).is_some());
        assert_eq!(collateral_value_micro(c, &after), 400_100_000_000); // rounding of the price only
    }

    #[test]
    fn bound_rejects_absurd_scalars() {
        let too_big = SolvencyScalars { k_c: 1 << 31, k_l: 150 };
        assert!(!scalar_bound_ok(&too_big));
        assert!(scalar_bound_ok(&SolvencyScalars { k_c: (1 << 31) - 1, k_l: 150 }));
        assert!(multiplier_scaled(f64::NAN).is_none());
        assert!(multiplier_scaled(0.0).is_none());
        assert!(multiplier_scaled(20_000.0).is_none());
        assert!(solvency_scalars(1, 1, 15_050).is_none(), "haircut must be a multiple of 100 bp");
    }
}
