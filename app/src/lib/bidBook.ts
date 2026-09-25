/**
 * The member's own bid book: size + Pedersen opening per bid, kept in this browser only
 * (localStorage, keyed by wallet). The chain never holds these; a lock proof needs them.
 */
import type { Address } from "@solana/kit";

export interface BidRecord {
  epoch: string;
  side: 0 | 1;
  tick: number;
  sizeMicroUsdc: string;
  opening: string; // hex
  ciphertext: string; // hex
  at: number;
}

const key = (wallet: Address) => `thewindow:bids:${wallet}`;

export function loadBidBook(wallet: Address): BidRecord[] {
  try {
    const raw = localStorage.getItem(key(wallet));
    return raw ? (JSON.parse(raw) as BidRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveBid(wallet: Address, rec: BidRecord): void {
  try {
    const book = loadBidBook(wallet).filter(
      (b) => !(b.epoch === rec.epoch && b.side === rec.side && b.tick === rec.tick),
    );
    book.push(rec);
    localStorage.setItem(key(wallet), JSON.stringify(book));
  } catch {
    // storage unavailable: the bid still stands on-chain; the lock flow will ask for the size
  }
}

export function findBid(wallet: Address, epoch: bigint, side: 0 | 1, tick: number): BidRecord | null {
  return loadBidBook(wallet).find((b) => b.epoch === epoch.toString() && b.side === side && b.tick === tick) ?? null;
}

/**
 * Folds records from a session file into this browser's book, newest wins on the same
 * epoch/side/tick. Returns how many were new — nothing is ever dropped to make room.
 */
export function mergeBidBook(wallet: Address, incoming: readonly BidRecord[]): number {
  const book = loadBidBook(wallet);
  const at = (b: BidRecord) => `${b.epoch}:${b.side}:${b.tick}`;
  const byKey = new Map(book.map((b) => [at(b), b]));
  let added = 0;
  for (const rec of incoming) {
    if (!byKey.has(at(rec))) added++;
    byKey.set(at(rec), rec);
  }
  try {
    localStorage.setItem(key(wallet), JSON.stringify([...byKey.values()]));
  } catch {
    return 0; // storage unavailable: nothing was kept, and saying "0 restored" is the truth
  }
  return added;
}
