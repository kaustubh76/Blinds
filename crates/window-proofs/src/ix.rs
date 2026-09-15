//! How proofs travel to the ZK ElGamal Proof program.
//!
//! * **Inline** — the proof instruction precedes the consuming instruction in the same
//!   transaction; the program reads its context through the Instructions sysvar. Used for
//!   PoCD (192 B) and bid validity (320 B).
//! * **Context-state account** — created (system program) and verified in a separate
//!   transaction; the consuming program reads and closes it. Required for range proofs (936 B).

use bytemuck::Pod;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use solana_zk_sdk::zk_elgamal_proof_program::{
    instruction::{close_context_state, ContextStateInfo, ProofInstruction},
    proof_data::{ProofType, ZkProofData},
    state::ProofContextState,
};

/// The ZK ElGamal Proof program id.
pub fn zk_program_id() -> Pubkey {
    solana_zk_sdk::zk_elgamal_proof_program::id()
}

/// Space of a context-state account for context type `U`.
pub const fn context_size<U: Pod>() -> usize {
    core::mem::size_of::<ProofContextState<U>>()
}

fn instruction_for<T: ZkProofData<U>, U: Pod>() -> ProofInstruction {
    match T::PROOF_TYPE {
        ProofType::ZeroCiphertext => ProofInstruction::VerifyZeroCiphertext,
        ProofType::CiphertextCiphertextEquality => {
            ProofInstruction::VerifyCiphertextCiphertextEquality
        }
        ProofType::CiphertextCommitmentEquality => {
            ProofInstruction::VerifyCiphertextCommitmentEquality
        }
        ProofType::PubkeyValidity => ProofInstruction::VerifyPubkeyValidity,
        ProofType::PercentageWithCap => ProofInstruction::VerifyPercentageWithCap,
        ProofType::BatchedRangeProofU64 => ProofInstruction::VerifyBatchedRangeProofU64,
        ProofType::BatchedRangeProofU128 => ProofInstruction::VerifyBatchedRangeProofU128,
        ProofType::BatchedRangeProofU256 => ProofInstruction::VerifyBatchedRangeProofU256,
        ProofType::GroupedCiphertext2HandlesValidity => {
            ProofInstruction::VerifyGroupedCiphertext2HandlesValidity
        }
        ProofType::BatchedGroupedCiphertext2HandlesValidity => {
            ProofInstruction::VerifyBatchedGroupedCiphertext2HandlesValidity
        }
        ProofType::GroupedCiphertext3HandlesValidity => {
            ProofInstruction::VerifyGroupedCiphertext3HandlesValidity
        }
        ProofType::BatchedGroupedCiphertext3HandlesValidity => {
            ProofInstruction::VerifyBatchedGroupedCiphertext3HandlesValidity
        }
        ProofType::Uninitialized => ProofInstruction::CloseContextState,
    }
}

/// Inline verification instruction (place it immediately before the consuming instruction).
pub fn verify_inline<T: Pod + ZkProofData<U>, U: Pod>(proof: &T) -> Instruction {
    instruction_for::<T, U>().encode_verify_proof(None, proof)
}

/// `[create_account, verify_into_context]` for a context-state account `ctx` owned by the ZK
/// program with `authority` as its close authority. `rent` is the rent-exempt minimum for
/// [`context_size::<U>()`]. Send the two instructions in *separate* transactions when the proof
/// is large (range proofs), or together when it fits.
pub fn create_and_verify<T: Pod + ZkProofData<U>, U: Pod>(
    payer: &Pubkey,
    ctx: &Pubkey,
    authority: &Pubkey,
    rent: u64,
    proof: &T,
) -> [Instruction; 2] {
    let create = solana_system_interface::instruction::create_account(
        payer,
        ctx,
        rent,
        context_size::<U>() as u64,
        &zk_program_id(),
    );
    let info = ContextStateInfo { context_state_account: ctx, context_state_authority: authority };
    let verify = instruction_for::<T, U>().encode_verify_proof(Some(info), proof);
    [create, verify]
}

/// Closes a context-state account, sending its lamports to `destination`.
pub fn close(ctx: &Pubkey, destination: &Pubkey, authority: &Pubkey) -> Instruction {
    close_context_state(
        ContextStateInfo { context_state_account: ctx, context_state_authority: authority },
        destination,
    )
}
