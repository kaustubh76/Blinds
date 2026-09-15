//! Baby-step giant-step discrete log for the administrator's aggregate decryption.
//!
//! `solana_zk_sdk::DiscreteLog::decode_u32` stops at 2^32; per-tick aggregates are bounded by
//! `n_t · 2^40` (spec §7.2), so the administrator needs a wider search. Giant steps walk *upward
//! from zero*, so realistic sums (a few thousand USDC ≈ 2^32 µUSDC) decode in microseconds and
//! only an aggregate near the bound approaches the worst case.

use std::collections::HashMap;

use curve25519_dalek::{
    constants::RISTRETTO_BASEPOINT_POINT, ristretto::RistrettoPoint, scalar::Scalar,
    traits::Identity,
};

use crate::{ciphertext::Ciphertext, decrypt, keys::Keypair, point::Point};

/// Precomputed baby table `i·G ↦ i` for `i < 2^baby_bits`, keyed by the first 8 bytes of the
/// compressed point (collisions are re-checked against the full point).
pub struct Solver {
    baby_bits: u8,
    table: HashMap<[u8; 8], u32>,
    giant_step: RistrettoPoint, // 2^baby_bits · G
}

impl Solver {
    /// Builds the table. `baby_bits = 20` (≈1M entries) takes ~1 s and ~50 MB.
    pub fn build(baby_bits: u8) -> Self {
        assert!((8..=28).contains(&baby_bits), "baby_bits must be in 8..=28");
        let n = 1usize << baby_bits;
        let mut table = HashMap::with_capacity(n);
        let mut p = RistrettoPoint::identity();
        for i in 0..n {
            let bytes = p.compress().to_bytes();
            table.insert(bytes[..8].try_into().expect("8 bytes"), i as u32);
            p += RISTRETTO_BASEPOINT_POINT;
        }
        Self { baby_bits, table, giant_step: p }
    }

    /// Table size exponent.
    pub const fn baby_bits(&self) -> u8 {
        self.baby_bits
    }

    /// Finds `v ≤ max_value` with `v·G == target`, or `None`.
    pub fn solve(&self, target: &Point, max_value: u64) -> Option<u64> {
        let target = curve25519_dalek::ristretto::CompressedRistretto(target.0).decompress()?;
        let m = 1u64 << self.baby_bits;
        let mut gamma = target;
        let mut j = 0u64;
        loop {
            let bytes = gamma.compress().to_bytes();
            if let Some(&i) = self.table.get::<[u8; 8]>(&bytes[..8].try_into().expect("8 bytes")) {
                let v = j.checked_mul(m)?.checked_add(i as u64)?;
                if v <= max_value && RISTRETTO_BASEPOINT_POINT * Scalar::from(v) == target {
                    return Some(v);
                }
            }
            j += 1;
            if j.checked_mul(m)? > max_value {
                return None;
            }
            gamma -= self.giant_step;
        }
    }

    /// Decrypts an aggregate under the auditor key: `solve(C − s·D, max_value)`.
    pub fn decrypt(&self, kp: &Keypair, ct: &Ciphertext, max_value: u64) -> Option<u64> {
        self.solve(&decrypt::to_point(kp, ct), max_value)
    }
}
