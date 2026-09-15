/**
 * Transaction plans (spec v2 §7.1, §9.5). A plan is a list of transactions to send in order; each
 * lists its instructions and the extra keypairs that must sign (the wallet signs everything).
 * Proofs come from the wasm (`proofs()`); the wallet's 64-byte signature over the member
 * signing message is the only secret material, and it never leaves the page.
 */
import { AccountRole, type Address, generateKeyPairSigner, type Instruction, type KeyPairSigner } from "@solana/kit";
import { getSubmitBidInstruction } from "./generated/window_auction/index.js";
import { getDepositCollateralInstruction, getLockCollateralInstruction } from "./generated/window_credit/index.js";
import { getWrapInstruction } from "./generated/window_wrap/index.js";
import * as pda from "./pda.js";
import {
  INSTRUCTIONS_SYSVAR,
  PROGRAMS,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  ZK_ELGAMAL_PROOF_PROGRAM,
} from "./programs.js";
import { proofs } from "./wasm.js";
import {
  CONTEXT_SIZE,
  closeContext,
  createContextAccount,
  ProofInstruction,
  verifyInline,
  verifyIntoContext,
} from "./zk.js";

export interface PlannedTx {
  label: string;
  instructions: Instruction[];
  extraSigners: KeyPairSigner[];
}
export interface Plan {
  txs: PlannedTx[];
}
export type Rent = (space: number) => Promise<bigint>;

/** Bid: create range ctx → verify range → [verify validity, submit_bid]. */
export async function buildBidPlan(args: {
  member: Address;
  signature: Uint8Array;
  auditorPubkey: Uint8Array;
  epoch: bigint;
  side: 0 | 1;
  tick: number;
  sizeMicroUsdc: bigint;
  sMin: bigint;
  rent: Rent;
}): Promise<Plan & { ciphertext: Uint8Array; opening: Uint8Array }> {
  const w = await proofs();
  const p = w.bid_proofs(args.signature, args.auditorPubkey, args.sizeMicroUsdc.toString(), args.sMin.toString()) as {
    ciphertext: Uint8Array;
    opening: Uint8Array;
    validity: Uint8Array;
    range: Uint8Array;
  };
  const ctx = await generateKeyPairSigner();
  const lamports = await args.rent(CONTEXT_SIZE.batchedRange);
  const submit = getSubmitBidInstruction({
    member: { address: args.member } as never,
    memberRecord: await pda.member(args.member),
    config: await pda.auctionConfig(),
    epoch: await pda.epoch(args.epoch),
    bid: await pda.bid(args.epoch, args.member, args.side, args.tick),
    rangeCtx: ctx.address,
    instructions: INSTRUCTIONS_SYSVAR,
    zkProgram: ZK_ELGAMAL_PROOF_PROGRAM,
    systemProgram: SYSTEM_PROGRAM,
    side: args.side,
    tick: args.tick,
  }) as unknown as Instruction;
  return {
    ciphertext: p.ciphertext,
    opening: p.opening,
    txs: [
      {
        label: "create range-proof context",
        instructions: [createContextAccount(args.member, ctx.address, CONTEXT_SIZE.batchedRange, lamports)],
        extraSigners: [ctx],
      },
      {
        label: "verify range proof",
        instructions: [
          verifyIntoContext(ProofInstruction.VerifyBatchedRangeProofU64, p.range, ctx.address, args.member),
        ],
        extraSigners: [],
      },
      {
        label: "verify validity + submit bid",
        instructions: [verifyInline(ProofInstruction.VerifyGroupedCiphertext2HandlesValidity, p.validity), submit],
        extraSigners: [],
      },
    ],
  };
}

/** Lock: four contexts (validity+equality in one tx, each range proof in its own) → lock_collateral. */
export async function buildLockPlan(args: {
  borrower: Address;
  signature: Uint8Array;
  auditorPubkey: Uint8Array;
  loan: Address;
  loanCiphertext: Uint8Array;
  loanSizeMicroUsdc: bigint;
  loanOpening: Uint8Array;
  sharesMilli: bigint;
  priceCents: bigint;
  multScaled: bigint;
  haircutBps: bigint;
  feedId: Uint8Array;
  mockMint: Address;
  rent: Rent;
}): Promise<Plan & { collateralCiphertext: Uint8Array; kC: bigint; kL: bigint }> {
  const w = await proofs();
  const p = w.lock_proofs(
    args.signature,
    args.auditorPubkey,
    args.sharesMilli.toString(),
    args.loanCiphertext,
    args.loanSizeMicroUsdc.toString(),
    args.loanOpening,
    args.priceCents.toString(),
    args.multScaled.toString(),
    args.haircutBps.toString(),
  ) as {
    collateral_ciphertext: Uint8Array;
    validity: Uint8Array;
    range32: Uint8Array;
    equality: Uint8Array;
    range64: Uint8Array;
    k_c: string;
    k_l: string;
  };
  const [cV, cR32, cE, cR64] = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  const [rV, rR, rE] = await Promise.all([
    args.rent(CONTEXT_SIZE.groupedCiphertext2Validity),
    args.rent(CONTEXT_SIZE.batchedRange),
    args.rent(CONTEXT_SIZE.ciphertextCommitmentEquality),
  ]);
  const b = args.borrower;
  const lock = getLockCollateralInstruction({
    borrower: { address: b } as never,
    config: await pda.creditConfig(),
    auctionConfig: await pda.auctionConfig(),
    borrowerRecord: await pda.member(b),
    loan: args.loan,
    priceCache: await pda.priceCache(args.feedId),
    mockMint: args.mockMint,
    validityCtx: cV.address,
    range32Ctx: cR32.address,
    equalityCtx: cE.address,
    range64Ctx: cR64.address,
    zkProgram: ZK_ELGAMAL_PROOF_PROGRAM,
  }) as unknown as Instruction;
  return {
    collateralCiphertext: p.collateral_ciphertext,
    kC: BigInt(p.k_c),
    kL: BigInt(p.k_l),
    txs: [
      {
        label: "verify collateral validity + delta equality",
        instructions: [
          createContextAccount(b, cV.address, CONTEXT_SIZE.groupedCiphertext2Validity, rV),
          verifyIntoContext(ProofInstruction.VerifyGroupedCiphertext2HandlesValidity, p.validity, cV.address, b),
          createContextAccount(b, cE.address, CONTEXT_SIZE.ciphertextCommitmentEquality, rE),
          verifyIntoContext(ProofInstruction.VerifyCiphertextCommitmentEquality, p.equality, cE.address, b),
        ],
        extraSigners: [cV, cE],
      },
      {
        label: "create collateral range context",
        instructions: [createContextAccount(b, cR32.address, CONTEXT_SIZE.batchedRange, rR)],
        extraSigners: [cR32],
      },
      {
        label: "verify collateral range (32-bit)",
        instructions: [verifyIntoContext(ProofInstruction.VerifyBatchedRangeProofU64, p.range32, cR32.address, b)],
        extraSigners: [],
      },
      {
        label: "create delta range context",
        instructions: [createContextAccount(b, cR64.address, CONTEXT_SIZE.batchedRange, rR)],
        extraSigners: [cR64],
      },
      {
        label: "verify delta range (64-bit)",
        instructions: [verifyIntoContext(ProofInstruction.VerifyBatchedRangeProofU64, p.range64, cR64.address, b)],
        extraSigners: [],
      },
      { label: "lock collateral (priced solvency proof)", instructions: [lock], extraSigners: [] },
    ],
  };
}

/** Wrap: the public token leg, then `ApplyPendingBalance` (owner-signed, no proof). */
export async function buildWrapPlan(args: {
  member: Address;
  mockMint: Address;
  cstockMint: Address;
  memberMock: Address;
  memberCstock: Address;
  amount: bigint;
  /** current pending-balance credit counter of the confidential account */
  pendingCreditCounter: bigint;
  newDecryptableBalance: Uint8Array;
}): Promise<Plan> {
  const vault = await pda.wrapVault(args.mockMint);
  const wrap = getWrapInstruction({
    member: { address: args.member } as never,
    memberRecord: await pda.member(args.member),
    vault,
    mockMint: args.mockMint,
    cstockMint: args.cstockMint,
    memberMock: args.memberMock,
    custody: await pda.ata(vault, args.mockMint),
    memberCstock: args.memberCstock,
    mintAuthority: await pda.wrapMintAuthority(),
    tokenProgram: TOKEN_2022_PROGRAM,
    amount: args.amount,
  }) as unknown as Instruction;
  const apply = applyPendingBalanceInstruction(
    args.memberCstock,
    args.member,
    args.pendingCreditCounter + 1n,
    args.newDecryptableBalance,
  );
  return {
    txs: [
      { label: "wrap (public leg)", instructions: [wrap], extraSigners: [] },
      { label: "apply pending balance", instructions: [apply], extraSigners: [] },
    ],
  };
}

/** Token-2022 `ConfidentialTransferExtension::ApplyPendingBalance` (27, 8). */
export function applyPendingBalanceInstruction(
  account: Address,
  owner: Address,
  expectedCredits: bigint,
  newDecryptable: Uint8Array,
): Instruction {
  const data = new Uint8Array(2 + 8 + 36);
  data[0] = 27;
  data[1] = 8;
  new DataView(data.buffer).setBigUint64(2, expectedCredits, true);
  data.set(newDecryptable, 10);
  return {
    programAddress: TOKEN_2022_PROGRAM,
    accounts: [
      { address: account, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}

/** Token-2022 confidential `Transfer` (27, 7) with all three proofs in context accounts. */
export function confidentialTransferInstruction(args: {
  source: Address;
  mint: Address;
  destination: Address;
  owner: Address;
  newSourceDecryptable: Uint8Array;
  auditorLo: Uint8Array;
  auditorHi: Uint8Array;
  equalityCtx: Address;
  validityCtx: Address;
  rangeCtx: Address;
}): Instruction {
  // TransferInstructionData: new_source_decryptable(36) lo(64) hi(64) eq_offset(1) val_offset(1) range_offset(1)
  const data = new Uint8Array(2 + 36 + 64 + 64 + 3);
  data[0] = 27;
  data[1] = 7;
  data.set(args.newSourceDecryptable, 2);
  data.set(args.auditorLo, 38);
  data.set(args.auditorHi, 102);
  return {
    programAddress: TOKEN_2022_PROGRAM,
    accounts: [
      { address: args.source, role: AccountRole.WRITABLE },
      { address: args.mint, role: AccountRole.READONLY },
      { address: args.destination, role: AccountRole.WRITABLE },
      { address: args.equalityCtx, role: AccountRole.READONLY },
      { address: args.validityCtx, role: AccountRole.READONLY },
      { address: args.rangeCtx, role: AccountRole.READONLY },
      { address: args.owner, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}

/** Deposit: proof contexts → [confidential transfer to escrow, deposit_collateral] → close contexts. */
export async function buildDepositPlan(args: {
  borrower: Address;
  tokenSignature: Uint8Array;
  borrowerCstock: Address;
  cstockMint: Address;
  escrow: Address;
  loan: Address;
  availableCt: Uint8Array;
  decryptable: Uint8Array;
  amountMilli: bigint;
  escrowElgamalPubkey: Uint8Array;
  auditorPubkey: Uint8Array;
  rent: Rent;
}): Promise<Plan> {
  const w = await proofs();
  const p = w.transfer_proofs(
    args.tokenSignature,
    args.availableCt,
    args.decryptable,
    args.amountMilli.toString(),
    args.escrowElgamalPubkey,
    args.auditorPubkey,
  ) as {
    equality: Uint8Array;
    validity: Uint8Array;
    range: Uint8Array;
    auditor_lo: Uint8Array;
    auditor_hi: Uint8Array;
    new_decryptable: Uint8Array;
  };
  const [cE, cV, cR] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
  const [rE, rV, rR] = await Promise.all([
    args.rent(CONTEXT_SIZE.ciphertextCommitmentEquality),
    args.rent(CONTEXT_SIZE.batchedGroupedCiphertext3Validity),
    args.rent(CONTEXT_SIZE.batchedRange),
  ]);
  const b = args.borrower;
  const transfer = confidentialTransferInstruction({
    source: args.borrowerCstock,
    mint: args.cstockMint,
    destination: args.escrow,
    owner: b,
    newSourceDecryptable: p.new_decryptable,
    auditorLo: p.auditor_lo,
    auditorHi: p.auditor_hi,
    equalityCtx: cE.address,
    validityCtx: cV.address,
    rangeCtx: cR.address,
  });
  const deposit = getDepositCollateralInstruction({
    borrower: { address: b } as never,
    config: await pda.creditConfig(),
    loan: args.loan,
    borrowerCstock: args.borrowerCstock,
    instructions: INSTRUCTIONS_SYSVAR,
  }) as unknown as Instruction;
  return {
    txs: [
      {
        label: "verify transfer equality proof",
        instructions: [
          createContextAccount(b, cE.address, CONTEXT_SIZE.ciphertextCommitmentEquality, rE),
          verifyIntoContext(ProofInstruction.VerifyCiphertextCommitmentEquality, p.equality, cE.address, b),
        ],
        extraSigners: [cE],
      },
      {
        label: "verify transfer validity proof",
        instructions: [
          createContextAccount(b, cV.address, CONTEXT_SIZE.batchedGroupedCiphertext3Validity, rV),
          verifyIntoContext(ProofInstruction.VerifyBatchedGroupedCiphertext3HandlesValidity, p.validity, cV.address, b),
        ],
        extraSigners: [cV],
      },
      {
        label: "create transfer range context",
        instructions: [createContextAccount(b, cR.address, CONTEXT_SIZE.batchedRange, rR)],
        extraSigners: [cR],
      },
      {
        label: "verify transfer range proof (128-bit)",
        instructions: [verifyIntoContext(ProofInstruction.VerifyBatchedRangeProofU128, p.range, cR.address, b)],
        extraSigners: [],
      },
      {
        label: "confidential transfer to escrow + deposit_collateral",
        instructions: [transfer, deposit],
        extraSigners: [],
      },
      {
        label: "close proof contexts",
        instructions: [closeContext(cE.address, b, b), closeContext(cV.address, b, b), closeContext(cR.address, b, b)],
        extraSigners: [],
      },
    ],
  };
}

export const programs = PROGRAMS;
