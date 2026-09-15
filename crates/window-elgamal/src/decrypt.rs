//! Decryption without BSGS: the holder of a key recovers `v·G` and can check it against an
//! expected amount (a borrower checking its loan ciphertext, a lender checking what to fund).

use solana_zk_sdk::encryption::elgamal::ElGamalCiphertext;

use crate::{ciphertext::Ciphertext, keys::Keypair, point::Point};

fn to_sdk(ct: &Ciphertext) -> ElGamalCiphertext {
    ElGamalCiphertext::from_bytes(&ct.to_bytes()).expect("64-byte layout")
}

/// `C − s·D = v·G`.
pub fn to_point(kp: &Keypair, ct: &Ciphertext) -> Point {
    let dl = kp.secret().decrypt(&to_sdk(ct));
    Point(dl.target.compress().to_bytes())
}

/// Whether `ct` encrypts exactly `expected` under `kp` (no discrete log needed).
pub fn equals(kp: &Keypair, ct: &Ciphertext, expected: u64) -> bool {
    match Point::from_amount(expected) {
        Ok(p) => to_point(kp, ct) == p,
        Err(_) => false,
    }
}
