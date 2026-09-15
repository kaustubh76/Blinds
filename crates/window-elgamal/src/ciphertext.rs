//! Ciphertext layouts and the homomorphic operations of the auction.

use bytemuck::{Pod, Zeroable};

use crate::point::{CurveError, Point, Scalar32, IDENTITY};

/// A twisted ElGamal ciphertext `(C, D)`: `C = m·G + r·H` (Pedersen commitment), `D = r·P`
/// (decrypt handle under pubkey `P`). 64 bytes, same layout as `PodElGamalCiphertext`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Pod, Zeroable)]
#[repr(C)]
pub struct Ciphertext {
    /// Pedersen commitment to the amount.
    pub commitment: Point,
    /// Decrypt handle for one key.
    pub handle: Point,
}

/// A grouped ciphertext with two decrypt handles sharing one commitment. 96 bytes, same layout as
/// `PodGroupedElGamalCiphertext2Handles`. Handle order for bids: `[member, auditor]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Pod, Zeroable)]
#[repr(C)]
pub struct GroupedCiphertext2 {
    /// Shared Pedersen commitment.
    pub commitment: Point,
    /// Decrypt handles, one per recipient key.
    pub handles: [Point; 2],
}

/// Three-handle variant (128 bytes) for completeness; not used by the auction path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Pod, Zeroable)]
#[repr(C)]
pub struct GroupedCiphertext3 {
    /// Shared Pedersen commitment.
    pub commitment: Point,
    /// Decrypt handles.
    pub handles: [Point; 3],
}

/// Per-tick accumulator `(Σ C_i, Σ D_auditor,i)`. The identity pair means "never accumulated".
pub type Accumulator = Ciphertext;

impl Ciphertext {
    /// The all-identity ciphertext: encryption of zero with zero randomness / an empty accumulator.
    pub const ZERO: Ciphertext = Ciphertext { commitment: IDENTITY, handle: IDENTITY };

    /// Whether both components are the identity.
    pub const fn is_zero(&self) -> bool {
        self.commitment.is_identity() && self.handle.is_identity()
    }

    /// Homomorphic addition of a bid into this accumulator, taking the bid's commitment and the
    /// handle at `handle_index` (the auditor's for the auction).
    pub fn accumulate(
        &self,
        bid: &GroupedCiphertext2,
        handle_index: usize,
    ) -> Result<Ciphertext, CurveError> {
        let handle = bid.handles.get(handle_index).ok_or(CurveError::InvalidPoint)?;
        Ok(Ciphertext {
            commitment: self.commitment.add(&bid.commitment)?,
            handle: self.handle.add(handle)?,
        })
    }

    /// The residual `(C − v·G, D)`: encrypts zero iff `v` is the true decryption. This is the
    /// ciphertext a proof-of-correct-decryption (`ZeroCiphertext` proof) is made over.
    pub fn residual(&self, claimed_sum: u64) -> Result<Ciphertext, CurveError> {
        let vg = Point::from_amount(claimed_sum)?;
        Ok(Ciphertext { commitment: self.commitment.sub(&vg)?, handle: self.handle })
    }

    /// `k·(C, D)` — scalar multiplication of both components.
    pub fn scale(&self, k: u64) -> Result<Ciphertext, CurveError> {
        let k = Scalar32::from_u64(k);
        Ok(Ciphertext { commitment: self.commitment.mul(&k)?, handle: self.handle.mul(&k)? })
    }

    /// Component-wise subtraction.
    pub fn sub(&self, other: &Ciphertext) -> Result<Ciphertext, CurveError> {
        Ok(Ciphertext {
            commitment: self.commitment.sub(&other.commitment)?,
            handle: self.handle.sub(&other.handle)?,
        })
    }

    /// Component-wise addition.
    pub fn add(&self, other: &Ciphertext) -> Result<Ciphertext, CurveError> {
        Ok(Ciphertext {
            commitment: self.commitment.add(&other.commitment)?,
            handle: self.handle.add(&other.handle)?,
        })
    }

    /// Raw 64 bytes (`commitment ‖ handle`).
    pub fn to_bytes(&self) -> [u8; 64] {
        let mut b = [0u8; 64];
        b[..32].copy_from_slice(&self.commitment.0);
        b[32..].copy_from_slice(&self.handle.0);
        b
    }
    /// From raw 64 bytes; layout only, no curve validation.
    pub fn from_bytes(b: &[u8; 64]) -> Self {
        let mut c = [0u8; 32];
        let mut h = [0u8; 32];
        c.copy_from_slice(&b[..32]);
        h.copy_from_slice(&b[32..]);
        Ciphertext { commitment: Point(c), handle: Point(h) }
    }
}

impl GroupedCiphertext2 {
    /// The ordinary ciphertext seen by the holder of key `handle_index`.
    pub fn to_ciphertext(&self, handle_index: usize) -> Option<Ciphertext> {
        self.handles
            .get(handle_index)
            .map(|h| Ciphertext { commitment: self.commitment, handle: *h })
    }
    /// Raw 96 bytes (`commitment ‖ handle₀ ‖ handle₁`).
    pub fn to_bytes(&self) -> [u8; 96] {
        let mut b = [0u8; 96];
        b[..32].copy_from_slice(&self.commitment.0);
        b[32..64].copy_from_slice(&self.handles[0].0);
        b[64..].copy_from_slice(&self.handles[1].0);
        b
    }
    /// From raw 96 bytes; layout only.
    pub fn from_bytes(b: &[u8; 96]) -> Self {
        let mut p = [[0u8; 32]; 3];
        for (i, chunk) in b.chunks_exact(32).enumerate() {
            p[i].copy_from_slice(chunk);
        }
        GroupedCiphertext2 { commitment: Point(p[0]), handles: [Point(p[1]), Point(p[2])] }
    }
}
