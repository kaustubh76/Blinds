//! The collateral claim and the priced solvency pair.

use curve25519_dalek::scalar::Scalar;
use solana_zk_elgamal_proof_interface::proof_data::{
    BatchedRangeProofU64Data, CiphertextCommitmentEqualityProofData,
    GroupedCiphertext2HandlesValidityProofData,
};
use solana_zk_sdk::{
    encryption::{
        elgamal::ElGamalCiphertext,
        grouped_elgamal::GroupedElGamalCiphertext,
        pedersen::{Pedersen, PedersenCommitment, PedersenOpening},
    },
    zk_elgamal_proof_program::{
        build_batched_range_proof_u64_data, build_ciphertext_commitment_equality_proof_data,
        build_grouped_ciphertext_2_handles_validity_proof_data,
    },
};
use window_elgamal::{
    encrypt::{self, Opening},
    keys::{pubkey_from_bytes, Keypair},
    solvency_delta, Ciphertext, GroupedCiphertext2, Point,
};

use crate::{
    error::ProofError,
    scalar::{self, SolvencyScalars, COLLATERAL_BITS},
};

/// A borrower's encrypted collateral claim: `c` milli-shares under (borrower, auditor).
pub struct CollateralClaim {
    /// Grouped ciphertext of `c`.
    pub ciphertext: GroupedCiphertext2,
    /// Kept by the borrower.
    pub opening: Opening,
    /// Validity under both keys.
    pub validity: GroupedCiphertext2HandlesValidityProofData,
    /// `c ∈ [0, 2^32)` with a padding commitment.
    pub range: BatchedRangeProofU64Data,
}

/// Encrypts and proves a collateral claim.
pub fn build_collateral(
    borrower: &Keypair,
    auditor_pk: &[u8; 32],
    shares_milli: u64,
) -> Result<CollateralClaim, ProofError> {
    if shares_milli >= 1u64 << COLLATERAL_BITS {
        return Err(ProofError::AmountRange);
    }
    let opening = Opening::random();
    let ciphertext =
        encrypt::grouped2_with(&borrower.pubkey_bytes(), auditor_pk, shares_milli, &opening)?;
    let sdk_ct = GroupedElGamalCiphertext::<2>::from_bytes(&ciphertext.to_bytes())
        .ok_or_else(|| ProofError::Generation("grouped ciphertext bytes".into()))?;
    let auditor = pubkey_from_bytes(auditor_pk)?;
    let validity = build_grouped_ciphertext_2_handles_validity_proof_data(
        borrower.pubkey(),
        &auditor,
        &sdk_ct,
        shares_milli,
        &opening.0,
    )?;
    let commitment: PedersenCommitment = Pedersen::with(shares_milli, &opening.0);
    let (pad, pad_open) = Pedersen::new(0u64);
    let range = build_batched_range_proof_u64_data(
        vec![&commitment, &pad],
        vec![shares_milli, 0],
        vec![COLLATERAL_BITS as usize, 64 - COLLATERAL_BITS as usize],
        vec![&opening.0, &pad_open],
    )?;
    Ok(CollateralClaim { ciphertext, opening, validity, range })
}

/// The pair that proves `k_c·c − k_l·ℓ ≥ 0`.
pub struct SolvencyProofs {
    /// Commitment `K` to `Δ`.
    pub delta_commitment: Point,
    /// `E_Δ` and `K` hold the same value.
    pub equality: CiphertextCommitmentEqualityProofData,
    /// `K ∈ [0, 2^64)`.
    pub range: BatchedRangeProofU64Data,
}

/// Inputs the borrower knows: both plaintexts and both openings.
pub struct SolvencyInputs<'a> {
    /// Collateral ciphertext (borrower handle) and its plaintext/opening.
    pub collateral: &'a Ciphertext,
    /// `c`.
    pub c: u64,
    /// Opening of the collateral ciphertext.
    pub c_opening: &'a Opening,
    /// Loan ciphertext (borrower handle).
    pub loan: &'a Ciphertext,
    /// `ℓ`.
    pub l: u64,
    /// Opening of the loan ciphertext.
    pub l_opening: &'a Opening,
}

/// Builds the solvency pair, or `Undercollateralized` if no valid proof exists.
pub fn build(
    borrower: &Keypair,
    inputs: &SolvencyInputs<'_>,
    s: &SolvencyScalars,
) -> Result<SolvencyProofs, ProofError> {
    if !scalar::scalar_bound_ok(s) {
        return Err(ProofError::ScalarBound);
    }
    let delta = scalar::delta(inputs.c, inputs.l, s).ok_or(ProofError::Undercollateralized)?;
    // E_Δ exactly as the program computes it.
    let e_delta = solvency_delta(inputs.collateral, s.k_c, inputs.loan, s.k_l)?;
    let e_delta_sdk = ElGamalCiphertext::from_bytes(&e_delta.to_bytes())
        .ok_or_else(|| ProofError::Generation("delta bytes".into()))?;
    // Opening of E_Δ: k_c·r_c − k_l·r_l.
    let kc_part: PedersenOpening = &inputs.c_opening.0 * Scalar::from(s.k_c);
    let kl_part: PedersenOpening = &inputs.l_opening.0 * Scalar::from(s.k_l);
    let o_delta: PedersenOpening = &kc_part - &kl_part;
    let k: PedersenCommitment = Pedersen::with(delta, &o_delta);
    let equality = build_ciphertext_commitment_equality_proof_data(
        &borrower.0,
        &e_delta_sdk,
        &k,
        &o_delta,
        delta,
    )?;
    let range =
        build_batched_range_proof_u64_data(vec![&k], vec![delta], vec![64], vec![&o_delta])?;
    Ok(SolvencyProofs { delta_commitment: Point(k.to_bytes()), equality, range })
}
