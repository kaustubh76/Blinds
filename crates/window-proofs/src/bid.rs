//! Bid proofs: validity under (member, auditor) and range on `(size − s_min)`.

use solana_zk_sdk::{
    encryption::{
        grouped_elgamal::GroupedElGamalCiphertext,
        pedersen::{Pedersen, PedersenCommitment},
    },
    zk_elgamal_proof_program::proof_data::{
        BatchedRangeProofU64Data, GroupedCiphertext2HandlesValidityProofData,
    },
};
use window_elgamal::{
    encrypt::{self, Opening},
    keys::{pubkey_from_bytes, Keypair},
    GroupedCiphertext2,
};

use crate::{error::ProofError, scalar::BID_BITS};

/// Everything a member sends for one bid, plus the opening it keeps.
pub struct BidProofs {
    /// The grouped ciphertext `(C, D_member, D_auditor)`.
    pub ciphertext: GroupedCiphertext2,
    /// The Pedersen opening — never leaves the prover.
    pub opening: Opening,
    /// Well-formedness under both keys (verified inline).
    pub validity: GroupedCiphertext2HandlesValidityProofData,
    /// `(size − s_min) ∈ [0, 2^40)` with a zero padding commitment (verified into a context account).
    pub range: BatchedRangeProofU64Data,
}

/// Builds the proofs for `size` micro-USDC with minimum `s_min`.
pub fn build(
    member: &Keypair,
    auditor_pk: &[u8; 32],
    size: u64,
    s_min: u64,
) -> Result<BidProofs, ProofError> {
    let shifted = size.checked_sub(s_min).ok_or(ProofError::AmountRange)?;
    if shifted >= 1u64 << BID_BITS {
        return Err(ProofError::AmountRange);
    }
    let opening = Opening::random();
    let ciphertext = encrypt::grouped2_with(&member.pubkey_bytes(), auditor_pk, size, &opening)?;
    let sdk_ct = GroupedElGamalCiphertext::<2>::from_bytes(&ciphertext.to_bytes())
        .ok_or_else(|| ProofError::Generation("grouped ciphertext bytes".into()))?;
    let auditor = pubkey_from_bytes(auditor_pk)?;
    let validity = GroupedCiphertext2HandlesValidityProofData::new(
        member.pubkey(),
        &auditor,
        &sdk_ct,
        size,
        &opening.0,
    )?;
    // C − s_min·G commits to (size − s_min) under the same opening.
    let shifted_commitment: PedersenCommitment = Pedersen::with(shifted, &opening.0);
    let (pad, pad_open) = Pedersen::new(0u64);
    let range = BatchedRangeProofU64Data::new(
        vec![&shifted_commitment, &pad],
        vec![shifted, 0],
        vec![BID_BITS as usize, 64 - BID_BITS as usize],
        vec![&opening.0, &pad_open],
    )?;
    Ok(BidProofs { ciphertext, opening, validity, range })
}
