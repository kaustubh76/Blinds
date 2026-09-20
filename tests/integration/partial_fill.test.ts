/**
 * A bid split across two lenders — the `MatchKind::Partial` path.
 *
 * It exists because LiteSVM accepted something the real runtime rejects: `post_match` closes the
 * partial-fill validity context with a CPI to the ZK ElGamal Proof program, and a CPI's callee must
 * be among the transaction's accounts. LiteSVM did not enforce that, tier 2 only ever produced
 * full fills, and devnet answered `An account required by the instruction is missing`. So the
 * partial path is now exercised on a real validator: the administrator posts it, the borrower opens
 * the ECDH-sealed opening note, recovers the part it owes, and proves solvency for exactly that.
 */
import { getAddressEncoder } from "@solana/kit";
import { fetchCreditConfig, fetchEpoch, fetchLoansFor, lockCollateral, proofs } from "@thewindow/solana-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { bidsTogether, SHARES, wrap } from "./flows";
import { airdrop, feedId, listing, type Member, mockMint, newMember, onboard, rentFor, rpc, waitFor } from "./harness";

// No single lender covers the bid, so the administrator must split it: one lender fills part of it
// and that loan carries a fresh ciphertext plus a sealed opening. The bid is larger than any
// simulated agent's ask (100–2,100 USDC), so an agent quoting the same tick cannot fill it alone
// (the matcher prefers one lender that covers the whole bid); agents may still join the split.
const BORROW = 5_000_000_000n; // 5,000 USDC (1,000 shares at ~$400 cover it at 150 % with room)
const LEND_SMALL = 2_000_000_000n; // 2,000 USDC
const LEND_REST = 3_000_000_000n; // 3,000 USDC

let lenderA: Member;
let lenderB: Member;
let borrower: Member;

beforeAll(async () => {
  [lenderA, lenderB, borrower] = await Promise.all([newMember(), newMember(), newMember()]);
  await Promise.all([airdrop(lenderA.address, 2), airdrop(lenderB.address, 2), airdrop(borrower.address, 2)]);
  for (const m of [lenderA, lenderB, borrower]) await onboard(m);
  await wrap(borrower, SHARES);
});

describe("a bid split across two lenders", () => {
  let epochIndex = 0n;

  it("submits two small asks and one larger bid into the same epoch", async () => {
    const [a, b, c] = await bidsTogether([
      { member: lenderA, side: 0, tick: 0, size: LEND_SMALL },
      { member: lenderB, side: 0, tick: 0, size: LEND_REST },
      { member: borrower, side: 1, tick: 36, size: BORROW },
    ]);
    if (!a || !b || !c) throw new Error("bid batch incomplete");
    expect(a.epoch).toBe(c.epoch);
    expect(b.epoch).toBe(c.epoch);
    epochIndex = c.epoch;
  });

  it("produces two loans for the borrower, at least one of them a partial fill", async () => {
    const loans = await waitFor(`two loans in epoch ${epochIndex}`, async () => {
      const l = await fetchLoansFor(rpc, borrower.address);
      const inEpoch = l.borrowed.filter((x) => x.data.epoch === epochIndex);
      return inEpoch.length >= 2 ? inEpoch : null;
    });
    const partials = loans.filter((l) => Array.from(l.data.openingNote).some((b) => b !== 0));
    expect(partials.length).toBeGreaterThan(0);
    // Our two lenders at least; a simulated agent asking at the same tick may take a slice too.
    const lenders = new Set(loans.map((l) => l.data.lender));
    expect(lenders.size).toBeGreaterThanOrEqual(2);
    expect(lenders.has(lenderA.address) || lenders.has(lenderB.address)).toBe(true);
  });

  it("the borrower opens the sealed note, recovers its part, and locks collateral for it", async () => {
    const [{ borrowed }, credit] = await Promise.all([fetchLoansFor(rpc, borrower.address), fetchCreditConfig(rpc)]);
    const loan = borrowed
      .filter((l) => l.data.epoch === epochIndex)
      .find((l) => Array.from(l.data.openingNote).some((b) => b !== 0));
    const epoch = await fetchEpoch(rpc, epochIndex);
    if (!loan || !epoch || !credit) throw new Error("partial loan state missing");

    const w = await proofs();
    const opening = new Uint8Array(
      w.open_note(
        borrower.memberSignature,
        new Uint8Array(epoch.auditorPubkey),
        new Uint8Array(loan.data.openingNote),
        new Uint8Array(getAddressEncoder().encode(loan.address)),
      ),
    );
    expect(opening.length).toBe(32);
    const part = w.decrypt_small(
      borrower.memberSignature,
      new Uint8Array(loan.data.sizeCt.slice(0, 64)),
      BORROW.toString(),
    );
    expect(part).not.toBeNull();
    const size = BigInt(part ?? "0");
    expect(size).toBeGreaterThan(0n);
    expect(size).toBeLessThan(BORROW);

    const { scalars } = await lockCollateral(rpc, {
      borrower: borrower.signer,
      signature: borrower.memberSignature,
      auditorPubkey: new Uint8Array(epoch.auditorPubkey),
      loan: loan.address,
      loanCiphertext: new Uint8Array(loan.data.sizeCt),
      loanSizeMicroUsdc: size,
      loanOpening: opening,
      listing,
      quote: { feedId, priceSource: 3 },
      haircutBps: credit.haircutBps,
      mockMint,
      rent: rentFor,
    });
    const after = await fetchLoansFor(rpc, borrower.address);
    const locked = after.borrowed.find((l) => l.address === loan.address);
    expect(locked?.data.status).toBe(2); // Requested
    expect(locked?.data.kC).toBe(scalars.kC);
  });
});
