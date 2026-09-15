//! Encryption helpers used by bidders, borrowers and the administrator.

use solana_zk_sdk::encryption::{
    elgamal::ElGamalPubkey,
    grouped_elgamal::GroupedElGamal,
    pedersen::{Pedersen, PedersenOpening},
};

use crate::{ciphertext::GroupedCiphertext2, keys::KeyError, keys::pubkey_from_bytes, point::Point};

/// The Pedersen opening (`r`) of a ciphertext; kept by the prover, never sent anywhere.
pub struct Opening(pub PedersenOpening);

impl Opening {
    /// Fresh random opening.
    pub fn random() -> Self {
        Self(PedersenOpening::new_rand())
    }
}

/// Encrypts `amount` under `(member, auditor)` with a fresh opening. Returns the grouped
/// ciphertext (handles in that order) and the opening the proofs need.
pub fn grouped2(member_pk: &[u8; 32], auditor_pk: &[u8; 32], amount: u64) -> Result<(GroupedCiphertext2, Opening), KeyError> {
    let opening = Opening::random();
    let ct = grouped2_with(member_pk, auditor_pk, amount, &opening)?;
    Ok((ct, opening))
}

/// Deterministic variant with a caller-supplied opening.
pub fn grouped2_with(member_pk: &[u8; 32], auditor_pk: &[u8; 32], amount: u64, opening: &Opening) -> Result<GroupedCiphertext2, KeyError> {
    let member: ElGamalPubkey = pubkey_from_bytes(member_pk)?;
    let auditor: ElGamalPubkey = pubkey_from_bytes(auditor_pk)?;
    let ct = GroupedElGamal::<2>::encrypt_with([&member, &auditor], amount, &opening.0);
    let bytes: [u8; 96] = ct.to_bytes().try_into().expect("grouped-2 ciphertext is 96 bytes");
    Ok(GroupedCiphertext2::from_bytes(&bytes))
}

/// Pedersen commitment `amount·G + r·H` for a known opening.
pub fn commit(amount: u64, opening: &Opening) -> Point {
    Point(Pedersen::with(amount, &opening.0).to_bytes())
}

/// A commitment to zero with a random opening: the padding commitment a batched range proof
/// needs to reach 64 bits (the proof program rejects identity commitments).
pub fn commit_random_zero() -> (Point, Opening) {
    let (c, o) = Pedersen::new(0u64);
    (Point(c.to_bytes()), Opening(o))
}
