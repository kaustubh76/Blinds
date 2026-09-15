//! Key material. Members derive their ElGamal (and AE) keys from a wallet signature over the
//! Token-2022 derivation message (`"solana-conf-bal/v1" ‖ public_seed`, HKDF-SHA512), so a browser
//! wallet, the agents and Token-2022 tooling all agree on the keys for a given seed.

use solana_zk_sdk::encryption::{
    auth_encryption::AeKey,
    derivation::{confidential_derivation_message, derive_confidential_keys_from_ikm},
    elgamal::{ElGamalKeypair, ElGamalPubkey, ElGamalSecretKey},
};

use crate::point::Point;

/// Public seed for a member's *auction* key (bids, loans, collateral claims). Confidential token
/// accounts use the token-account address as the seed instead, like the CLI.
pub const MEMBER_KEY_SEED: &[u8] = b"thewindow:member:v1";

/// The exact bytes a wallet signs to derive its confidential keys for `public_seed`.
pub fn signing_message(public_seed: &[u8]) -> Vec<u8> {
    confidential_derivation_message(public_seed)
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
    /// From a wallet signature (64 bytes) over [`signing_message`].
    pub fn from_signature(signature: &[u8; 64]) -> Result<Self, KeyError> {
        Self::from_seed(signature)
    }
    /// From any ≥ 32-byte seed (the auditor's operational key is derived from a stored seed).
    pub fn from_seed(seed: &[u8]) -> Result<Self, KeyError> {
        Self::pair_from_seed(seed).map(|(k, _)| k)
    }
    /// Both keys (ElGamal + AE) from one seed, as a confidential token account derives them.
    pub fn pair_from_seed(seed: &[u8]) -> Result<(Self, AeKey), KeyError> {
        let (elgamal, ae) =
            derive_confidential_keys_from_ikm(seed).map_err(|e| KeyError::Seed(e.to_string()))?;
        Ok((Self(elgamal), ae))
    }
    /// Public key as a compressed point (what the registry stores).
    pub fn pubkey_bytes(&self) -> [u8; 32] {
        self.0.pubkey().to_bytes()
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
    Keypair::pair_from_seed(signature).map(|(_, ae)| ae)
}
