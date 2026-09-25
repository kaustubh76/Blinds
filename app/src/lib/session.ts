/**
 * The session file: this browser's burner key and its bid book in one document, so a member can move
 * a position to another browser instead of losing it. The openings in the book are the only copy that
 * exists anywhere — the chain never held them, and a lock proof cannot be built without them.
 */
import type { Address } from "@solana/kit";
import { config } from "../config";
import { type BidRecord, loadBidBook, mergeBidBook } from "./bidBook";
import { adoptBurner, burnerAddress, exportBurnerSecretHex } from "./burner";

export const SESSION_KIND = "thewindow:session";
export const SESSION_VERSION = 1;

export interface SessionFile {
  kind: typeof SESSION_KIND;
  version: number;
  cluster: string;
  address: string;
  secretHex?: string;
  bids: BidRecord[];
  exportedAt: string;
}

/** What an import put back, so the screen can state it rather than imply it. */
export interface Restored {
  address: Address;
  keyRestored: boolean;
  bidsAdded: number;
  bidsAlreadyHere: number;
  unreadable: number;
  cluster: string;
  clusterMatches: boolean;
}

function isRecord(v: unknown): v is BidRecord {
  const b = v as Partial<BidRecord> | null;
  return (
    !!b &&
    typeof b.epoch === "string" &&
    (b.side === 0 || b.side === 1) &&
    typeof b.tick === "number" &&
    typeof b.sizeMicroUsdc === "string" &&
    typeof b.opening === "string" &&
    /^[0-9a-f]*$/i.test(b.opening) &&
    typeof b.ciphertext === "string"
  );
}

/** Everything this browser holds for the burner, or null when there is no burner to carry. */
export function exportSession(): SessionFile | null {
  const address = burnerAddress();
  if (!address) return null;
  const secretHex = exportBurnerSecretHex();
  return {
    kind: SESSION_KIND,
    version: SESSION_VERSION,
    cluster: config.cluster,
    address,
    ...(secretHex ? { secretHex } : {}),
    bids: loadBidBook(address),
    exportedAt: new Date().toISOString(),
  };
}

export function sessionFileName(f: SessionFile): string {
  return `thewindow-${f.cluster}-${f.address.slice(0, 8)}.json`;
}

/**
 * Writes the session file to the visitor's disk, returning what it wrote or null when there is nothing
 * to carry. Both callers matter: the Settings sheet, and the error screen — the one moment a member is
 * about to forget a key on purpose.
 */
export function downloadSession(): SessionFile | null {
  const file = exportSession();
  if (!file) return null;
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = sessionFileName(file);
  document.body.append(a); // Safari and Firefox ignore a click on an anchor that is not in the page
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0); // revoking in the same tick cancels the save
  return file;
}

/**
 * Restores a session file over this browser's. Bids merge, so importing never costs a record that is
 * only here; a record we cannot read is counted and reported, never dropped in silence.
 */
export async function importSession(text: string): Promise<Restored> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("that file is not JSON — pick the file the Download button wrote");
  }
  const f = parsed as Partial<SessionFile>;
  if (f?.kind !== SESSION_KIND) throw new Error("that JSON is not a session file from this app");
  if (typeof f.version !== "number" || f.version > SESSION_VERSION) {
    throw new Error(`that file is version ${String(f.version)}; this app reads ${SESSION_VERSION}`);
  }
  if (typeof f.address !== "string" || !f.address) throw new Error("that session file names no wallet");

  const address = f.secretHex ? await adoptBurner(f.secretHex) : (f.address as Address);
  if (f.secretHex && address !== f.address) {
    throw new Error("that file's key and wallet do not match each other — it was edited or truncated");
  }

  const raw = Array.isArray(f.bids) ? f.bids : [];
  const good = raw.filter(isRecord);
  const before = loadBidBook(address).length;
  const bidsAdded = good.length > 0 ? mergeBidBook(address, good) : 0;
  return {
    address,
    keyRestored: !!f.secretHex,
    bidsAdded,
    bidsAlreadyHere: before,
    unreadable: raw.length - good.length,
    cluster: typeof f.cluster === "string" ? f.cluster : "unknown",
    clusterMatches: f.cluster === config.cluster,
  };
}

export const plural = (n: number, thing: string): string => `${n} ${thing}${n === 1 ? "" : "s"}`;

/** One line for the screen: what came back, in the order a member cares about. */
export function restoredSummary(r: Restored): string {
  const parts = [r.keyRestored ? "key restored" : "key kept as it was", `${plural(r.bidsAdded, "bid record")} added`];
  if (r.unreadable > 0) parts.push(`${r.unreadable} unreadable`);
  if (!r.clusterMatches) parts.push(`exported on ${r.cluster}, this browser reads ${config.cluster}`);
  return parts.join(" · ");
}
