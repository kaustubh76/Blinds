//! Opening notes: how the administrator hands a borrower the Pedersen opening of a *partial-fill*
//! loan ciphertext it did not create, so the borrower can still prove solvency for it.
//!
//! Both parties hold twisted-ElGamal keys `(s, P = s⁻¹·H)`, so a Diffie–Hellman secret exists
//! without any extra key material: `K = s_a⁻¹·P_b = s_b⁻¹·P_a = (s_a·s_b)⁻¹·H`. The note is the
//! 32-byte opening XORed with `SHA-256("thewindow:opening-note:v1" ‖ K ‖ context)` — a one-time pad
//! under a per-loan key. It reveals nothing to anyone else; the administrator knows the opening
//! anyway (it chose it), so no new trust is introduced.

use curve25519_dalek::ristretto::CompressedRistretto;
use sha2::{Digest, Sha256};

use crate::keys::{pubkey_from_bytes, KeyError, Keypair};

/// Shared secret between `mine` and the holder of `theirs` (compressed point bytes).
pub fn shared_secret(mine: &Keypair, theirs: &[u8; 32]) -> Result<[u8; 32], KeyError> {
    let pk = pubkey_from_bytes(theirs)?;
    let inv = mine.secret().get_scalar().invert();
    let k = pk.get_point() * inv;
    Ok(k.compress().to_bytes())
}

fn pad(shared: &[u8; 32], context: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"thewindow:opening-note:v1");
    h.update(shared);
    h.update(context);
    h.finalize().into()
}

/// Seals a 32-byte opening for the counterparty; `context` binds it to one loan.
pub fn seal(opening: &[u8; 32], shared: &[u8; 32], context: &[u8]) -> [u8; 32] {
    let p = pad(shared, context);
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = opening[i] ^ p[i];
    }
    out
}

/// Recovers the opening; `None` if the result is not a canonical scalar.
pub fn open(note: &[u8; 32], shared: &[u8; 32], context: &[u8]) -> Option<[u8; 32]> {
    let opening = seal(note, shared, context);
    let _ = CompressedRistretto(opening); // type only
    curve25519_dalek::scalar::Scalar::from_canonical_bytes(opening).into_option().map(|_| opening)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encrypt::Opening;

    #[test]
    fn dh_is_symmetric_and_the_note_round_trips() {
        let admin = Keypair::random();
        let member = Keypair::random();
        let k1 = shared_secret(&admin, &member.pubkey_bytes()).unwrap();
        let k2 = shared_secret(&member, &admin.pubkey_bytes()).unwrap();
        assert_eq!(k1, k2);
        let opening = Opening::random().0.to_bytes();
        let note = seal(&opening, &k1, b"loan-1");
        assert_ne!(note, opening);
        assert_eq!(open(&note, &k2, b"loan-1"), Some(opening));
        assert_ne!(open(&note, &k2, b"loan-2"), Some(opening), "bound to the loan");
        let other = Keypair::random();
        let k3 = shared_secret(&other, &admin.pubkey_bytes()).unwrap();
        assert_ne!(open(&note, &k3, b"loan-1"), Some(opening));
    }
}
