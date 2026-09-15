//! Key material. Members derive their ElGamal (and AE) keys from a wallet signature over a fixed
//! message, exactly the way Token-2022 tooling does (`b"ElGamalSecretKey" ‖ public_seed`), so a
//! browser wallet, the agents and the spl-token CLI all agree on the key for a given seed.

use solana_zk_sdk::encryption::{
    auth_encryption::AeKey,
    elgamal::{ElGamalKeypair, ElGamalPubkey, ElGamalSecretKey},
};
use solana_seed_derivable::SeedDerivable;

use crate::point::Point;

/// Public seed for a member's *auction* key (bids, loans, collateral claims). Confidential token
/// accounts use the token-account address as the seed instead, like the CLI.
pub const MEMBER_KEY_SEED: &[u8] = b"thewindow:member:v1";

/// The exact bytes a wallet signs to derive an ElGamal key for `public_seed`.
pub fn elgamal_signing_message(public_seed: &[u8]) -> Vec<u8> {
    [b"ElGamalSecretKey".as_slice(), public_seed].concat()
}

/// The exact bytes a wallet signs to derive an authenticated-encryption key for `public_seed`.
pub fn ae_signing_message(public_seed: &[u8]) -> Vec<u8> {
    [b"AeKey".as_slice(), public_seed].concat()
}

/// Key derivation / parsing failure.
#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    /// Seed shorter than 32 bytes or otherwise unusable.
    #[error("invalid seed: {0}")]
    Seed(String),
    /// Bytes are not a valid ElGamal public key.
    #[error("invalid ElGamal public key")]
    Pubkey,
}

/// A member's or the auditor's ElGamal keypair.
pub struct Keypair(pub ElGamalKeypair);

impl Keypair {
    /// Fresh random keypair (agents, tests, auditor bootstrap).
    pub fn random() -> Self {
        Self(ElGamalKeypair::new_rand())
    }
    /// From a wallet signature (64 bytes) over [`elgamal_signing_message`].
    pub fn from_signature(signature: &[u8; 64]) -> Result<Self, KeyError> {
        Self::from_seed(signature)
    }
    /// From any ≥ 32-byte seed (the auditor's operational key is derived from a stored seed).
    pub fn from_seed(seed: &[u8]) -> Result<Self, KeyError> {
        let secret = ElGamalSecretKey::from_seed(seed).map_err(|e| KeyError::Seed(e.to_string()))?;
        Ok(Self(ElGamalKeypair::new(secret)))
    }
    /// Public key as a compressed point (what the registry stores).
    pub fn pubkey_bytes(&self) -> [u8; 32] {
        (*self.0.pubkey()).into()
    }
    /// Public key as a [`Point`].
    pub fn pubkey_point(&self) -> Point {
        Point(self.pubkey_bytes())
    }
    /// Underlying SDK pubkey.
    pub fn pubkey(&self) -> &ElGamalPubkey {
        self.0.pubkey()
    }
    /// Underlying SDK secret.
    pub fn secret(&self) -> &ElGamalSecretKey {
        self.0.secret()
    }
}

/// Parses 32 bytes as an ElGamal public key.
pub fn pubkey_from_bytes(bytes: &[u8; 32]) -> Result<ElGamalPubkey, KeyError> {
    ElGamalPubkey::try_from(bytes.as_slice()).map_err(|_| KeyError::Pubkey)
}

/// Authenticated-encryption key for a confidential token account's decryptable balance.
pub fn ae_key_from_signature(signature: &[u8; 64]) -> Result<AeKey, KeyError> {
    AeKey::from_seed(signature).map_err(|e| KeyError::Seed(e.to_string()))
}
