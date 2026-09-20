/**
 * The collateral schedule on a real validator: a borrower whose accounts sit on listing #1 wraps
 * that collateral, bids, and — after the print — locks against listing #1's price cache with its
 * haircut, then deposits into listing #1's escrow. The loan ends up bound to listing #1, and the
 * operator confirms it exactly as it would a listing-#0 loan.
 */
import { getAddressEncoder } from "@solana/kit";
import {
  buildDepositPlan,
  fetchConfidentialAccount,
  fetchEpoch,
  fetchListing,
  fetchListings,
  fetchLoansFor,
  fetchPrice,
  fetchPrint,
  LoanStatus,
  lockCollateral,
  PrintStatus,
  proofs,
  sendPlan,
  symbolOf,
} from "@thewindow/solana-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { balances, bidsTogether, SHARES, wrap } from "./flows";
import { airdrop, auditorPubkey, listings, type Member, newMember, onboard, rentFor, rpc, waitFor } from "./harness";

const BORROW = 500_000_000n; // 500 USDC
const LEND = 50_000_000_000n;

let lender: Member;
let borrower: Member;
const second = listings[1] ?? failListing();
function failListing(): never {
  throw new Error("the integration profile lists only one collateral");
}

beforeAll(async () => {
  [lender, borrower] = await Promise.all([newMember(), newMember(second)]);
  await Promise.all([airdrop(lender.address, 2), airdrop(borrower.address, 2)]);
});

describe("a second listing of the collateral schedule", () => {
  it("is on chain with its own haircut, feed id and escrow", async () => {
    const all = await fetchListings(rpc);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const l = await fetchListing(rpc, second.cstockMint);
    if (!l) throw new Error("listing #1 missing");
    expect(symbolOf(l)).toBe(second.symbol);
    expect(l.haircutBps).toBe(second.haircutBps);
    expect(Array.from(l.feedId)).toEqual(Array.from(second.feedId));
    expect(l.escrowAccount).toBe(second.escrow);
    expect(l.cstockMint).toBe(second.cstockMint);
    // both listings are priced by the keeper
    const price = await waitFor("listing #1 price", () => fetchPrice(rpc, second.feedId));
    expect(price.price).toBeGreaterThan(0n);
  });

  it("onboards a member on listing #1 and wraps its collateral", async () => {
    await onboard(lender);
    await onboard(borrower);
    await wrap(lender, SHARES);
    await wrap(borrower, SHARES);
    const b = await balances(borrower);
    expect(b.available).toBe(SHARES);
    const acc = await fetchConfidentialAccount(rpc, borrower.cstockAta);
    expect(acc.configured).toBe(true);
  });

  let epochIndex = 0n;
  let opening: Uint8Array = new Uint8Array();
  let ciphertext: Uint8Array = new Uint8Array();
  it("bids and is matched after the print", async () => {
    const [l, b] = await bidsTogether([
      { member: lender, side: 0, tick: 0, size: LEND },
      { member: borrower, side: 1, tick: 36, size: BORROW },
    ]);
    if (!l || !b) throw new Error("bids missing");
    epochIndex = b.epoch;
    opening = b.opening;
    ciphertext = b.ciphertext;
    const print = await waitFor(`print of epoch ${epochIndex}`, async () => {
      const p = await fetchPrint(rpc, epochIndex);
      return p && p.status === PrintStatus.Printed ? p : null;
    });
    expect(print.status).toBe(PrintStatus.Printed);
    const loan = await waitFor("the borrower's loan", async () => {
      const { borrowed } = await fetchLoansFor(rpc, borrower.address);
      return borrowed.find((x) => x.data.epoch === epochIndex) ?? null;
    });
    expect(loan.data.status).toBe(LoanStatus.Pending);
    expect(loan.data.listing).toBe("11111111111111111111111111111111"); // unbound until the lock
  });

  it("locks against listing #1's price and haircut, deposits into listing #1's escrow", async () => {
    const [{ borrowed }, epoch] = await Promise.all([
      fetchLoansFor(rpc, borrower.address),
      fetchEpoch(rpc, epochIndex),
    ]);
    const loan = borrowed.find((x) => x.data.epoch === epochIndex);
    if (!loan || !epoch) throw new Error("state missing");
    const w = await proofs();
    const full = Array.from(loan.data.sizeCt).every((x, i) => x === ciphertext[i]);
    const size = full
      ? BORROW
      : BigInt(
          w.decrypt_small(borrower.memberSignature, new Uint8Array(loan.data.sizeCt.slice(0, 64)), BORROW.toString()) ??
            "0",
        );
    const loanOpening = full
      ? opening
      : new Uint8Array(
          w.open_note(
            borrower.memberSignature,
            new Uint8Array(epoch.auditorPubkey),
            new Uint8Array(loan.data.openingNote),
            new Uint8Array(getAddressEncoder().encode(loan.address)),
          ),
        );
    const { scalars, sharesMilli: need } = await lockCollateral(rpc, {
      borrower: borrower.signer,
      signature: borrower.memberSignature,
      auditorPubkey: new Uint8Array(epoch.auditorPubkey),
      loan: loan.address,
      loanCiphertext: new Uint8Array(loan.data.sizeCt),
      loanSizeMicroUsdc: size,
      loanOpening,
      listing: second.listing,
      quote: { feedId: second.feedId, priceSource: 3 },
      haircutBps: second.haircutBps,
      mockMint: second.mockMint,
      rent: rentFor,
    });
    expect(scalars.kL).toBe(second.haircutBps / 100n);
    expect(need).toBeLessThanOrEqual(SHARES);
    let l = await fetchLoansFor(rpc, borrower.address);
    let mine = l.borrowed.find((x) => x.address === loan.address);
    expect(mine?.data.status).toBe(LoanStatus.Requested);
    expect(mine?.data.listing).toBe(second.listing);
    expect(mine?.data.kL).toBe(scalars.kL);

    const b = await balances(borrower);
    const escrowAcc = await fetchConfidentialAccount(rpc, second.escrow);
    if (!escrowAcc.view) throw new Error("escrow");
    const deposit = await buildDepositPlan({
      borrower: borrower.signer,
      tokenSignature: borrower.tokenSignature,
      borrowerCstock: borrower.cstockAta,
      cstockMint: second.cstockMint,
      escrow: second.escrow,
      listing: second.listing,
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
    mine = l.borrowed.find((x) => x.address === loan.address);
    expect([LoanStatus.Deposited, LoanStatus.Locked, LoanStatus.Active]).toContain(mine?.data.status);
    // the operator confirms a listing-#1 lock like any other
    const confirmed = await waitFor("operator confirmation", async () => {
      const { borrowed: now } = await fetchLoansFor(rpc, borrower.address);
      const x = now.find((y) => y.address === loan.address);
      return x && x.data.status >= LoanStatus.Locked ? x : null;
    });
    expect(confirmed.data.listing).toBe(second.listing);
  });
});
