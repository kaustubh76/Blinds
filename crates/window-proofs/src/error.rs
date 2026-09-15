//! Errors of the proof builders.

/// Proof construction failure.
#[derive(Debug, thiserror::Error)]
pub enum ProofError {
    /// A key could not be parsed or derived.
    #[error("key: {0}")]
    Key(#[from] window_elgamal::keys::KeyError),
    /// The ZK SDK refused to build the proof (bit lengths, amounts).
    #[error("proof generation: {0}")]
    Generation(String),
    /// A curve operation failed.
    #[error("curve: {0}")]
    Curve(#[from] window_elgamal::CurveError),
    /// The collateral does not cover the haircut; no valid proof exists.
    #[error("undercollateralized")]
    Undercollateralized,
    /// Scalars violate the soundness bound.
    #[error("scalar bound violated")]
    ScalarBound,
    /// Size outside the provable range.
    #[error("amount out of range")]
    AmountRange,
}

impl From<solana_zk_sdk::zk_elgamal_proof_program::errors::ProofGenerationError> for ProofError {
    fn from(e: solana_zk_sdk::zk_elgamal_proof_program::errors::ProofGenerationError) -> Self {
        Self::Generation(e.to_string())
    }
}
