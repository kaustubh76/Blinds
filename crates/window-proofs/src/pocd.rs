//! Proof of correct decryption of a per-tick aggregate.

use solana_zk_sdk::{
    encryption::elgamal::ElGamalCiphertext,
    zk_elgamal_proof_program::proof_data::ZeroCiphertextProofData,
};
use window_elgamal::{keys::Keypair, Ciphertext};

use crate::error::ProofError;

/// `ZeroCiphertext` proof over the residual `(C − claimed_sum·G, D)` under the auditor key.
pub fn build(
    auditor: &Keypair,
    accumulator: &Ciphertext,
    claimed_sum: u64,
) -> Result<ZeroCiphertextProofData, ProofError> {
    let residual = accumulator.residual(claimed_sum)?;
    let sdk = ElGamalCiphertext::from_bytes(&residual.to_bytes())
        .ok_or_else(|| ProofError::Generation("residual bytes".into()))?;
    Ok(ZeroCiphertextProofData::new(&auditor.0, &sdk)?)
}
