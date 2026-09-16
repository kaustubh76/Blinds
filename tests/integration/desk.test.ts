/**
 * The dashboard's path, end to end, on a real validator with the real services:
 *   join → confidential account → wrap → encrypted bid (lender + borrower) → keeper closes the
 *   epoch → administrator prints (PoCD) → print re-verified from chain data → matches posted →
 *   borrower locks (priced solvency proof) → confidential transfer to escrow + deposit → operator
 *   confirms → funding → repayment → collateral released back to the borrower.
 */
import { getAddressEncoder, getBase64Encoder, type ReadonlyUint8Array } from "@solana/kit";
import {
  applyPendingBalanceInstruction,
  auction,
  buildDepositPlan,
  buildLockPlan,
  collateralPledge,
  credit,
  fetchBid,
  fetchConfidentialAccount,
  fetchCreditConfig,
  fetchEpoch,
  fetchLoansFor,
  fetchMember,
  fetchMultiplier,
  fetchPrice,
  fetchPrint,
  fetchTokenAmount,
  LoanStatus,
  multiplierScaled,
  oracle,
  PROGRAMS,
  PrintStatus,
  priceCents,
  proofs,
  sendPlan,
  solvencyScalars,
  verifyPrint,
} from "@thewindow/solana-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { balances, bid, SHARES, wrap } from "./flows";
import {
  airdrop,
  auditorPubkey,
  cstockMint,
  escrow,
  feedId,
  type Member,
  mockMint,
  newMember,
  onboard,
  rentFor,
  rpc,
  waitFor,
} from "./harness";

const BORROW = 1_000_000_000n; // 1,000 USDC bid at the top tick (always filled)
const LEND = 50_000_000_000n; // 50,000 USDC ask at the bottom tick (always crosses)

let lender: Member;
let borrower: Member;
const sizes = { lender: 0n, borrower: 0n }; // sizes + openings stay client-side, like the app's bid book
const openings: { lender: Uint8Array; borrower: Uint8Array } = { lender: new Uint8Array(), borrower: new Uint8Array() };
const ciphertexts: { borrower: Uint8Array } = { borrower: new Uint8Array() };

beforeAll(async () => {
  [lender, borrower] = await Promise.all([newMember(), newMember()]);
  await Promise.all([airdrop(lender.address, 2), airdrop(borrower.address, 2)]);
});

describe("desk lifecycle through the SDK", () => {
  it("joins and configures confidential accounts (pubkey validity proof inline)", async () => {
    await onboard(lender);
    await onboard(borrower);
    for (const m of [lender, borrower]) {
      const rec = await fetchMember(rpc, m.address);
      expect(rec?.active).toBe(true);
      expect(Array.from(rec?.elgamalPubkey ?? [])).toEqual(Array.from(m.elgamalPubkey));
      expect(await fetchTokenAmount(rpc, m.mockAta)).toBe(10_000_000n);
      const acc = await fetchConfidentialAccount(rpc, m.cstockAta);
      expect(acc.configured).toBe(true);
      expect(acc.view?.elgamalPubkey).toBeDefined();
    }
  });

  it("wraps: public leg into custody, pending credit applied, balance decrypts to the wrapped amount", async () => {
    await wrap(lender, SHARES);
    await wrap(borrower, SHARES);
    for (const m of [lender, borrower]) {
      const b = await balances(m);
      expect(b.available).toBe(SHARES);
      expect(b.pending).toBe(0n);
      expect(await fetchTokenAmount(rpc, m.mockAta)).toBe(10_000_000n - SHARES);
    }
  });

  let epochIndex = 0n;
  it("submits encrypted bids on both sides (range proof context + inline validity proof)", async () => {
    const l = await bid(lender, 0, 0, LEND);
    const b = await bid(borrower, 1, 36, BORROW);
    expect(b.epoch).toBe(l.epoch);
    epochIndex = b.epoch;
    sizes.lender = LEND;
    sizes.borrower = BORROW;
    openings.lender = l.opening;
    openings.borrower = b.opening;
    ciphertexts.borrower = b.ciphertext;
    const onChain = await fetchBid(rpc, epochIndex, borrower.address, 1, 36);
    expect(Array.from(onChain?.ciphertext ?? [])).toEqual(Array.from(b.ciphertext));
    // the bid ciphertext decrypts (only) with the member's own key
    const w = await proofs();
    expect(w.ciphertext_equals(borrower.memberSignature, b.ciphertext.slice(0, 64), BORROW.toString())).toBe(true);
    expect(w.ciphertext_equals(lender.memberSignature, b.ciphertext.slice(0, 64), BORROW.toString())).toBe(false);
  });

  it("the epoch is printed by the administrator and the print re-verifies from chain data alone", async () => {
    const print = await waitFor(`print of epoch ${epochIndex}`, async () => {
      const p = await fetchPrint(rpc, epochIndex);
      return p && (p.status === PrintStatus.Printed || p.status === PrintStatus.NoTrade) ? p : null;
    });
    expect(print.status).toBe(PrintStatus.Printed);
    expect(print.claimedSum[1]?.[36]).toBeGreaterThanOrEqual(BORROW);
    expect(print.claimedSum[0]?.[0]).toBeGreaterThanOrEqual(LEND);
    const verdict = await verifyPrint(rpc, epochIndex);
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.proven).toBe(verdict.nonzero);
    expect(verdict.r_star_recomputed).toBe(print.rStarTick);
  });

  it("the borrower's bid is matched into a loan whose size only the borrower and auditor can read", async () => {
    const { borrowed } = await waitFor("loan for the borrower", async () => {
      const l = await fetchLoansFor(rpc, borrower.address);
      return l.borrowed.length > 0 ? l : null;
    });
    const loan = borrowed[0];
    if (!loan) throw new Error("no loan");
    expect(loan.data.epoch).toBe(epochIndex);
    expect(loan.data.bidTick).toBe(36);
    expect(loan.data.status).toBe(LoanStatus.Pending);
    expect(loan.data.tick).toBeLessThanOrEqual(36);
    const w = await proofs();
    const full = Array.from(loan.data.sizeCt).every((x, i) => x === ciphertexts.borrower[i]);
    if (full) {
      expect(
        w.ciphertext_equals(borrower.memberSignature, new Uint8Array(loan.data.sizeCt.slice(0, 64)), BORROW.toString()),
      ).toBe(true);
    } else {
      // partial fill: the opening note unseals with the borrower's key and the part is below the bid
      const epoch = await fetchEpoch(rpc, epochIndex);
      const opening = w.open_note(
        borrower.memberSignature,
        new Uint8Array(epoch?.auditorPubkey ?? []),
        new Uint8Array(loan.data.openingNote),
        new Uint8Array(getAddressEncoder().encode(loan.address)),
      );
      expect(opening.length).toBe(32);
      const part = w.decrypt_small(
        borrower.memberSignature,
        new Uint8Array(loan.data.sizeCt.slice(0, 64)),
        BORROW.toString(),
      );
      expect(part).not.toBeNull();
      expect(BigInt(part ?? "0")).toBeLessThan(BORROW);
    }
  });

  it("locks collateral with a priced solvency proof, then deposits it to escrow in one transaction with the deposit", async () => {
    const credit = await fetchCreditConfig(rpc);
    const [{ borrowed }, epoch, price, mult] = await Promise.all([
      fetchLoansFor(rpc, borrower.address),
      fetchEpoch(rpc, epochIndex),
      fetchPrice(rpc, feedId),
      fetchMultiplier(rpc, mockMint),
    ]);
    const loan = borrowed[0];
    if (!loan || !epoch || !price || !credit) throw new Error("state missing");
    const w = await proofs();
    const full = Array.from(loan.data.sizeCt).every((x, i) => x === ciphertexts.borrower[i]);
    const opening = full
      ? openings.borrower
      : new Uint8Array(
          w.open_note(
            borrower.memberSignature,
            new Uint8Array(epoch.auditorPubkey),
            new Uint8Array(loan.data.openingNote),
            new Uint8Array(getAddressEncoder().encode(loan.address)),
          ),
        );
    const size = full
      ? BORROW
      : BigInt(
          w.decrypt_small(borrower.memberSignature, new Uint8Array(loan.data.sizeCt.slice(0, 64)), BORROW.toString()) ??
            "0",
        );
    const pc = priceCents(price.price, price.expo);
    const multScaled = multiplierScaled(mult.multiplier);
    const scalars = solvencyScalars(pc, multScaled, credit.haircutBps);
    const need = collateralPledge(size, scalars);
    expect(need).toBeLessThanOrEqual(SHARES);
    const lock = await buildLockPlan({
      borrower: borrower.signer,
      signature: borrower.memberSignature,
      auditorPubkey: new Uint8Array(epoch.auditorPubkey),
      loan: loan.address,
      loanCiphertext: new Uint8Array(loan.data.sizeCt),
      loanSizeMicroUsdc: size,
      loanOpening: opening,
      sharesMilli: need,
      priceCents: pc,
      multScaled,
      haircutBps: credit.haircutBps,
      feedId,
      mockMint,
      rent: rentFor,
    });
    await sendPlan(rpc, lock, borrower.signer);
    let l = await fetchLoansFor(rpc, borrower.address);
    expect(l.borrowed[0]?.data.status).toBe(LoanStatus.Requested);
    expect(l.borrowed[0]?.data.kC).toBe(scalars.kC);
    expect(l.borrowed[0]?.data.kL).toBe(scalars.kL);

    const b = await balances(borrower);
    const escrowAcc = await fetchConfidentialAccount(rpc, escrow);
    if (!escrowAcc.view) throw new Error("escrow");
    const deposit = await buildDepositPlan({
      borrower: borrower.signer,
      tokenSignature: borrower.tokenSignature,
      borrowerCstock: borrower.cstockAta,
      cstockMint,
      escrow,
      loan: loan.address,
      availableCt: b.view.availableBalance,
      decryptable: b.view.decryptableAvailableBalance,
      amountMilli: need,
      escrowElgamalPubkey: new Uint8Array(getAddressEncoder().encode(escrowAcc.view.elgamalPubkey)),
      auditorPubkey,
      rent: rentFor,
    });
    await sendPlan(rpc, deposit, borrower.signer);
    l = await fetchLoansFor(rpc, borrower.address);
    // Deposited, unless the operator (polling every 1.5 s) already confirmed the lock.
    expect([LoanStatus.Deposited, LoanStatus.Locked]).toContain(l.borrowed[0]?.data.status);
    expect((await balances(borrower)).available).toBe(SHARES - need);
  });

  it("operator confirms, funding and repayment are attested, collateral comes back to the borrower", async () => {
    const repaid = await waitFor(
      "loan repaid",
      async () => {
        const l = await fetchLoansFor(rpc, borrower.address);
        const loan = l.borrowed[0]?.data;
        return loan && loan.status === LoanStatus.Repaid && loan.collateralReleased ? loan : null;
      },
      240_000,
    );
    expect(repaid.status).toBe(LoanStatus.Repaid);
    // the released collateral lands in the pending balance; applying it restores the full amount
    const before = await balances(borrower);
    expect(before.pending).toBeGreaterThan(0n);
    const w = await proofs();
    const nb = new Uint8Array(
      w.encrypt_balance(borrower.tokenSignature, (before.available + before.pending).toString()),
    );
    const ix = applyPendingBalanceInstruction(
      borrower.cstockAta,
      borrower.address,
      before.view.pendingBalanceCreditCounter,
      nb,
    );
    await sendPlan(rpc, { txs: [{ label: "apply pending", instructions: [ix], extraSigners: [] }] }, borrower.signer);
    const after = await balances(borrower);
    expect(after.available).toBe(SHARES);
    expect(after.pending).toBe(0n);
  });

  it("leak audit: no plaintext size in any transaction, log or program account (spec §14, tier 2)", async () => {
    const { borrowed } = await fetchLoansFor(rpc, borrower.address);
    const loan = borrowed[0]?.data;
    if (!loan) throw new Error("loan");
    const need = collateralPledge(BORROW, { kC: loan.kC, kL: loan.kL });
    const secrets: Array<[string, bigint]> = [
      ["borrow size", BORROW],
      ["lend size", LEND],
      ["collateral", need],
    ];
    const hits = await leakScan(secrets, [borrower.address, lender.address]);
    // Leak budget (spec §14): per-tick aggregates, matched volume and the marginal pro-rata ratio are
    // published by the print (and the ratio is copied into each loan at the marginal tick as
    // `fill_num/fill_den`). Our members are alone at their ticks, so those aggregates equal their
    // sizes — by design. Anywhere else (Bid, Loan fields other than the ratio, Epoch, instruction
    // data, logs) a plaintext size is a leak.
    const LOAN_FILL_OFFSETS = [85, 93]; // fill_num, fill_den (after discriminator, lender, borrower, epoch, 5 × u8)
    const allowed = hits.filter(
      (h) =>
        h.kind === "Print" ||
        h.kind === "OracleState" ||
        (h.kind === "Loan" && h.offset !== undefined && LOAN_FILL_OFFSETS.includes(h.offset)),
    );
    const leaks = hits.filter((h) => !allowed.includes(h));
    console.log(`leak audit: ${hits.length} hit(s), ${allowed.length} in published aggregates`);
    expect(leaks).toEqual([]);
  });
});

/** Scans instruction data, logs and program-owned account data for LE-u64 / decimal-ASCII encodings of each secret. */
const { PRINT_DISCRIMINATOR, ORACLE_STATE_DISCRIMINATOR } = oracle;
const { BID_DISCRIMINATOR, EPOCH_DISCRIMINATOR } = auction;
const { LOAN_DISCRIMINATOR } = credit;

interface Hit {
  where: string;
  kind: string;
  secret: string;
  offset?: number;
}
const KINDS: Array<[string, ReadonlyUint8Array]> = [
  ["Print", PRINT_DISCRIMINATOR],
  ["OracleState", ORACLE_STATE_DISCRIMINATOR],
  ["Bid", BID_DISCRIMINATOR],
  ["Epoch", EPOCH_DISCRIMINATOR],
  ["Loan", LOAN_DISCRIMINATOR],
];
function kindOf(data: Uint8Array): string {
  for (const [name, disc] of KINDS) if (disc.every((b, i) => data[i] === b)) return name;
  return "other";
}

async function leakScan(secrets: Array<[string, bigint]>, wallets: string[]): Promise<Hit[]> {
  const b64 = getBase64Encoder();
  const needles = secrets.flatMap(([name, v]) => {
    const le = new Uint8Array(8);
    new DataView(le.buffer).setBigUint64(0, v, true);
    return [
      { name: `${name} (LE u64)`, bytes: le, decimal: false },
      { name: `${name} (ascii)`, bytes: new TextEncoder().encode(v.toString()), decimal: true },
    ];
  });
  // A decimal needle must stand alone: "987" inside a compute-unit count like "589874" is
  // arithmetic noise, while a real leak reads as its own number.
  const isDigit = (b: number | undefined) => b !== undefined && b >= 0x30 && b <= 0x39;
  const indexOf = (hay: Uint8Array, needle: Uint8Array, decimal = false): number => {
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      if (decimal && (isDigit(hay[i - 1]) || isDigit(hay[i + needle.length]))) continue;
      return i;
    }
    return -1;
  };
  const contains = (hay: Uint8Array, needle: Uint8Array, decimal = false) => indexOf(hay, needle, decimal) >= 0;
  const hits: Hit[] = [];
  for (const w of wallets) {
    const sigs = await rpc.getSignaturesForAddress(w as never, { limit: 200 }).send();
    for (const s of sigs) {
      const tx = await rpc
        .getTransaction(s.signature, { encoding: "base64", maxSupportedTransactionVersion: 0 })
        .send();
      if (!tx) continue;
      const raw = new Uint8Array(b64.encode(tx.transaction[0]));
      const logs = new TextEncoder().encode((tx.meta?.logMessages ?? []).join("\n"));
      for (const n of needles) {
        if (contains(raw, n.bytes, n.decimal))
          hits.push({ where: `tx ${s.signature}`, kind: "transaction", secret: n.name });
        if (contains(logs, n.bytes, n.decimal))
          hits.push({ where: `logs of ${s.signature}`, kind: "logs", secret: n.name });
      }
    }
  }
  for (const program of Object.values(PROGRAMS)) {
    const accounts = await rpc.getProgramAccounts(program, { encoding: "base64" }).send();
    for (const a of accounts) {
      const data = new Uint8Array(b64.encode(a.account.data[0]));
      for (const n of needles) {
        const offset = indexOf(data, n.bytes, n.decimal);
        if (offset >= 0) hits.push({ where: `account ${a.pubkey}`, kind: kindOf(data), secret: n.name, offset });
      }
    }
  }
  return hits;
}
