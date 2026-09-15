/** ZK ElGamal Proof program: instruction encoding and context-state account sizing. */
import { AccountRole, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import { ZK_ELGAMAL_PROOF_PROGRAM } from "./programs.js";

export const ProofInstruction = {
  CloseContextState: 0,
  VerifyZeroCiphertext: 1,
  VerifyCiphertextCiphertextEquality: 2,
  VerifyCiphertextCommitmentEquality: 3,
  VerifyPubkeyValidity: 4,
  VerifyPercentageWithCap: 5,
  VerifyBatchedRangeProofU64: 6,
  VerifyBatchedRangeProofU128: 7,
  VerifyBatchedRangeProofU256: 8,
  VerifyGroupedCiphertext2HandlesValidity: 9,
  VerifyBatchedGroupedCiphertext2HandlesValidity: 10,
  VerifyGroupedCiphertext3HandlesValidity: 11,
  VerifyBatchedGroupedCiphertext3HandlesValidity: 12,
} as const;
export type ProofInstructionKind = (typeof ProofInstruction)[keyof typeof ProofInstruction];

/** `ProofContextState<U>` = authority (32) + proof_type (1) + context. */
export const CONTEXT_SIZE = {
  zeroCiphertext: 33 + 96,
  ciphertextCommitmentEquality: 33 + 128,
  pubkeyValidity: 33 + 32,
  batchedRange: 33 + 264,
  groupedCiphertext2Validity: 33 + 160,
  batchedGroupedCiphertext3Validity: 33 + 352, // 3 pubkeys + grouped lo + grouped hi (4 points each)
} as const;

/** Inline verification: place immediately before the consuming instruction. */
export function verifyInline(kind: ProofInstructionKind, proofData: Uint8Array): Instruction {
  const data = new Uint8Array(1 + proofData.length);
  data[0] = kind;
  data.set(proofData, 1);
  return { programAddress: ZK_ELGAMAL_PROOF_PROGRAM, accounts: [], data };
}

/** Verification into a context-state account (`ctx` must already exist, owned by the ZK program). */
export function verifyIntoContext(
  kind: ProofInstructionKind,
  proofData: Uint8Array,
  ctx: Address,
  authority: Address,
): Instruction {
  const data = new Uint8Array(1 + proofData.length);
  data[0] = kind;
  data.set(proofData, 1);
  return {
    programAddress: ZK_ELGAMAL_PROOF_PROGRAM,
    accounts: [
      { address: ctx, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY },
    ],
    data,
  };
}

export function createContextAccount(
  payer: TransactionSigner,
  ctx: TransactionSigner,
  space: number,
  lamports: bigint,
): Instruction {
  return getCreateAccountInstruction({
    payer,
    newAccount: ctx,
    lamports,
    space: BigInt(space),
    programAddress: ZK_ELGAMAL_PROOF_PROGRAM,
  }) as unknown as Instruction;
}

export function closeContext(ctx: Address, destination: Address, authority: Address): Instruction {
  return {
    programAddress: ZK_ELGAMAL_PROOF_PROGRAM,
    accounts: [
      { address: ctx, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data: new Uint8Array([ProofInstruction.CloseContextState]),
  };
}
