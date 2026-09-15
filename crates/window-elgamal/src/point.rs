//! Compressed Ristretto points and scalars with the four group operations the mechanism needs.

use bytemuck::{Pod, Zeroable};
use solana_curve25519::{
    ristretto::{
        add_ristretto, multiply_ristretto, subtract_ristretto, validate_ristretto,
        PodRistrettoPoint,
    },
    scalar::PodScalar,
};

/// A compressed Ristretto point. Identical bytes to `solana_zk_sdk`'s pod types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Pod, Zeroable)]
#[repr(transparent)]
pub struct Point(pub [u8; 32]);

/// A canonical little-endian scalar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Pod, Zeroable)]
#[repr(transparent)]
pub struct Scalar32(pub [u8; 32]);

/// The Ristretto basepoint `G`, i.e. `curve25519_dalek::constants::RISTRETTO_BASEPOINT_COMPRESSED`
/// (asserted equal in the host tests). Amounts are encoded as `v·G`.
pub const BASEPOINT: Point = Point([
    0xe2, 0xf2, 0xae, 0x0a, 0x6a, 0xbc, 0x4e, 0x71, 0xa8, 0x84, 0xa9, 0x61, 0xc5, 0x00, 0x51, 0x5f,
    0x58, 0xe3, 0x0b, 0x6a, 0xa5, 0x82, 0xdd, 0x8d, 0xb6, 0xa6, 0x59, 0x45, 0xe0, 0x8d, 0x2d, 0x76,
]);

/// The identity element compresses to all zeroes.
pub const IDENTITY: Point = Point([0u8; 32]);

/// Curve operation failure: an input was not a valid Ristretto encoding (or the syscall failed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CurveError {
    /// Invalid point encoding or syscall failure.
    #[error("invalid Ristretto point")]
    InvalidPoint,
}

impl Point {
    /// Whether the bytes decode to a valid Ristretto point.
    pub fn is_valid(&self) -> bool {
        validate_ristretto(&PodRistrettoPoint(self.0))
    }
    /// The identity element (`0·G`).
    pub const fn is_identity(&self) -> bool {
        let mut i = 0;
        while i < 32 {
            if self.0[i] != 0 {
                return false;
            }
            i += 1;
        }
        true
    }
    /// `self + other`.
    pub fn add(&self, other: &Point) -> Result<Point, CurveError> {
        add_ristretto(&PodRistrettoPoint(self.0), &PodRistrettoPoint(other.0))
            .map(|p| Point(p.0))
            .ok_or(CurveError::InvalidPoint)
    }
    /// `self − other`.
    pub fn sub(&self, other: &Point) -> Result<Point, CurveError> {
        subtract_ristretto(&PodRistrettoPoint(self.0), &PodRistrettoPoint(other.0))
            .map(|p| Point(p.0))
            .ok_or(CurveError::InvalidPoint)
    }
    /// `k·self`.
    pub fn mul(&self, k: &Scalar32) -> Result<Point, CurveError> {
        multiply_ristretto(&PodScalar(k.0), &PodRistrettoPoint(self.0))
            .map(|p| Point(p.0))
            .ok_or(CurveError::InvalidPoint)
    }
    /// `v·G` for a plaintext amount.
    pub fn from_amount(v: u64) -> Result<Point, CurveError> {
        BASEPOINT.mul(&Scalar32::from_u64(v))
    }
}

impl Scalar32 {
    /// Canonical scalar for a `u64` (always reduced).
    pub const fn from_u64(v: u64) -> Self {
        let mut b = [0u8; 32];
        let le = v.to_le_bytes();
        let mut i = 0;
        while i < 8 {
            b[i] = le[i];
            i += 1;
        }
        Self(b)
    }
}
