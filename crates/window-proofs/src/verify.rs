//! Re-verification of a print or a loan from raw account data — what the indexer's
//! `/verify/:epoch`, the SDK badge (via wasm) and the attack tests use.

use solana_zk_elgamal_proof_interface::proof_data::{
    BatchedRangeProofU64Data, CiphertextCommitmentEqualityProofData, ZeroCiphertextProofData,
    ZkProofData,
};
use solana_zk_sdk::zk_elgamal_proof_program::VerifyZkProof;
use window_clearing::{clear, DepthCurve, TICKS};
use window_elgamal::{solvency_delta, Ciphertext, GroupedCiphertext2, Point};

/// The parts of an `Epoch` account a verifier needs.
pub struct EpochView {
    /// Auditor key stamped at `open_epoch`.
    pub auditor_pubkey: [u8; 32],
    /// `acc[side][tick]`.
    pub acc: [[Ciphertext; TICKS]; 2],
    /// `bid_count[side][tick]`.
    pub bid_count: [[u32; TICKS]; 2],
}

/// The parts of a `Print` account a verifier needs.
pub struct PrintView {
    /// `claimed_sum[side][tick]`.
    pub claimed_sum: [[u64; TICKS]; 2],
    /// Printed r\*, if any.
    pub r_star_tick: Option<u8>,
    /// Printed matched volume.
    pub matched: u64,
}

/// Verdict of [`print`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrintVerdict {
    /// Nonzero accumulators.
    pub nonzero: usize,
    /// Nonzero accumulators with a valid, correctly bound proof.
    pub proven: usize,
    /// r\* recomputed from the claimed sums.
    pub r_star_recomputed: Option<u8>,
    /// Everything checks out.
    pub ok: bool,
    /// Human-readable reasons when `ok == false`.
    pub failures: Vec<String>,
}

/// Re-verifies a print: every nonzero tick has a proof whose context is the residual of the
/// on-chain accumulator and the claimed sum under the auditor key, the proof itself verifies,
/// sums respect the bound, zero ticks are identity with sum 0, and the printed r\* matches.
pub fn print(
    epoch: &EpochView,
    print: &PrintView,
    proofs: &[ZeroCiphertextProofData],
) -> PrintVerdict {
    let mut failures = Vec::new();
    let mut nonzero = 0;
    let mut proven = 0;
    let mut curve = DepthCurve::default();
    for side in 0..2 {
        for t in 0..TICKS {
            let acc = &epoch.acc[side][t];
            let sum = print.claimed_sum[side][t];
            if side == 0 {
                curve.ask[t] = sum;
            } else {
                curve.bid[t] = sum;
            }
            if epoch.bid_count[side][t] == 0 {
                if !acc.is_zero() || sum != 0 {
                    failures.push(format!(
                        "side {side} tick {t}: zero-count tick is not identity/zero"
                    ));
                }
                continue;
            }
            nonzero += 1;
            if !window_clearing::bound_ok(sum, epoch.bid_count[side][t]) {
                failures.push(format!("side {side} tick {t}: sum exceeds n·2^40"));
                continue;
            }
            let Ok(residual) = acc.residual(sum) else {
                failures.push(format!("side {side} tick {t}: residual failed"));
                continue;
            };
            let found = proofs.iter().find(|p| {
                let ctx = p.context_data();
                bytemuck::bytes_of(&ctx.ciphertext) == residual.to_bytes()
                    && bytemuck::bytes_of(&ctx.pubkey) == epoch.auditor_pubkey
            });
            match found {
                Some(p) if p.verify_proof().is_ok() => proven += 1,
                Some(_) => failures.push(format!("side {side} tick {t}: proof does not verify")),
                None => {
                    failures.push(format!("side {side} tick {t}: no proof bound to this residual"))
                }
            }
        }
    }
    let r_star_recomputed = match clear(&curve) {
        Ok(c) => c.map(|c| c.r_star.get()),
        Err(_) => {
            failures.push("clearing overflow".into());
            None
        }
    };
    if r_star_recomputed != print.r_star_tick {
        failures.push(format!(
            "r* mismatch: printed {:?}, recomputed {:?}",
            print.r_star_tick, r_star_recomputed
        ));
    }
    if let (Ok(Some(c)), Some(_)) = (clear(&curve), print.r_star_tick) {
        if c.matched != print.matched {
            failures.push(format!(
                "matched mismatch: printed {}, recomputed {}",
                print.matched, c.matched
            ));
        }
    }
    let ok = failures.is_empty() && proven == nonzero;
    PrintVerdict { nonzero, proven, r_star_recomputed, ok, failures }
}

/// The parts of a `Loan` account a verifier needs.
pub struct LoanView {
    /// Borrower ElGamal key.
    pub borrower_pubkey: [u8; 32],
    /// Loan ciphertext (grouped; handle 0 = borrower).
    pub size_ct: GroupedCiphertext2,
    /// Collateral ciphertext (grouped; handle 0 = borrower).
    pub collateral_ct: GroupedCiphertext2,
    /// Commitment to Δ recorded at lock.
    pub delta_commitment: Point,
    /// Scalars recorded at lock.
    pub k_c: u64,
    /// Scalars recorded at lock.
    pub k_l: u64,
}

/// Re-verifies a lock: the equality proof binds `E_Δ` (recomputed from the loan's ciphertexts and
/// scalars) to the recorded commitment under the borrower's key, and the range proof covers it.
pub fn solvency(
    loan: &LoanView,
    eq: &CiphertextCommitmentEqualityProofData,
    range: &BatchedRangeProofU64Data,
) -> Result<(), String> {
    let (Some(ec), Some(el)) = (loan.collateral_ct.to_ciphertext(0), loan.size_ct.to_ciphertext(0))
    else {
        return Err("bad handles".into());
    };
    let e_delta = solvency_delta(&ec, loan.k_c, &el, loan.k_l).map_err(|e| e.to_string())?;
    let ctx = eq.context_data();
    if bytemuck::bytes_of(&ctx.pubkey) != loan.borrower_pubkey {
        return Err("equality proof is not under the borrower key".into());
    }
    if bytemuck::bytes_of(&ctx.ciphertext) != e_delta.to_bytes() {
        return Err("equality proof is not over E_delta".into());
    }
    if bytemuck::bytes_of(&ctx.commitment) != loan.delta_commitment.0 {
        return Err("equality proof commitment differs from the recorded one".into());
    }
    let rctx = range.context_data();
    if bytemuck::bytes_of(&rctx.commitments[0]) != loan.delta_commitment.0
        || rctx.bit_lengths[0] != 64
    {
        return Err("range proof is not a 64-bit proof over the recorded commitment".into());
    }
    eq.verify_proof().map_err(|e| format!("equality: {e}"))?;
    range.verify_proof().map_err(|e| format!("range: {e}"))?;
    Ok(())
}
