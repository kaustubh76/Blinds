import { beforeEach, describe, expect, it } from "vitest";

// A Map-backed localStorage so the stores work outside a browser; clearing it is a fresh browser.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

const { createBurner, burnerAddress, exportBurnerSecretHex } = await import("./burner");
const { loadBidBook, saveBid } = await import("./bidBook");
const { exportSession, importSession, restoredSummary, sessionFileName } = await import("./session");

const rec = (tick: number, epoch = "7") => ({
  epoch,
  side: 0 as const,
  tick,
  sizeMicroUsdc: "1500000",
  opening: "ab".repeat(32),
  ciphertext: "cd".repeat(64),
  at: 1_700_000_000_000,
});

describe("session file", () => {
  beforeEach(() => mem.clear());

  it("carries the key and the bid book to another browser", async () => {
    const addr = await createBurner();
    saveBid(addr, rec(12));
    saveBid(addr, rec(18));
    const file = exportSession();
    if (!file) throw new Error("expected a session file");
    expect(file.address).toBe(addr);
    expect(file.bids).toHaveLength(2);
    const text = JSON.stringify(file);

    mem.clear(); // a different browser, holding nothing
    expect(burnerAddress()).toBeNull();
    const r = await importSession(text);
    expect(r.address).toBe(addr);
    expect(r.keyRestored).toBe(true);
    expect(r.bidsAdded).toBe(2);
    expect(r.unreadable).toBe(0);
    expect(burnerAddress()).toBe(addr);
    expect(exportBurnerSecretHex()).toBe(file.secretHex);
    expect(
      loadBidBook(addr)
        .map((b) => b.tick)
        .sort(),
    ).toEqual([12, 18]);
    expect(restoredSummary(r)).toContain("key restored");
  });

  it("never costs a record that only this browser has", async () => {
    const addr = await createBurner();
    saveBid(addr, rec(12));
    const text = JSON.stringify(exportSession());

    saveBid(addr, rec(30)); // made after the export, and it has to survive the import
    const r = await importSession(text);
    expect(r.bidsAdded).toBe(0);
    expect(
      loadBidBook(addr)
        .map((b) => b.tick)
        .sort((a, b) => a - b),
    ).toEqual([12, 30]);
  });

  it("counts records it cannot read instead of dropping them in silence", async () => {
    const addr = await createBurner();
    const file = exportSession();
    if (!file) throw new Error("expected a session file");
    file.bids = [rec(12), { epoch: "7", side: 9 } as unknown as (typeof file.bids)[number]];
    const r = await importSession(JSON.stringify(file));
    expect(r.bidsAdded).toBe(1);
    expect(r.unreadable).toBe(1);
    expect(restoredSummary(r)).toContain("1 unreadable");
    expect(loadBidBook(addr)).toHaveLength(1);
  });

  it("refuses a file whose key and wallet disagree", async () => {
    await createBurner();
    const file = exportSession();
    if (!file) throw new Error("expected a session file");
    const other = { ...file, address: "11111111111111111111111111111111" };
    await expect(importSession(JSON.stringify(other))).rejects.toThrow(/do not match/);
  });

  it("refuses what is not a session file", async () => {
    await expect(importSession("not json")).rejects.toThrow(/not JSON/);
    await expect(importSession(JSON.stringify({ kind: "something-else" }))).rejects.toThrow(/not a session file/);
    await expect(importSession(JSON.stringify({ kind: "thewindow:session", version: 99 }))).rejects.toThrow(/version/);
  });

  it("restores a book without a key when the file carries none", async () => {
    const addr = await createBurner();
    saveBid(addr, rec(12));
    const file = exportSession();
    if (!file) throw new Error("expected a session file");
    delete file.secretHex;
    mem.clear();
    const r = await importSession(JSON.stringify(file));
    expect(r.keyRestored).toBe(false);
    expect(r.bidsAdded).toBe(1);
    expect(loadBidBook(addr)).toHaveLength(1);
    expect(restoredSummary(r)).toContain("key kept as it was");
  });

  it("names the download after the cluster and the wallet", async () => {
    const addr = await createBurner();
    const file = exportSession();
    if (!file) throw new Error("expected a session file");
    expect(sessionFileName(file)).toBe(`thewindow-${file.cluster}-${addr.slice(0, 8)}.json`);
  });

  it("has nothing to export before there is a burner", () => {
    expect(exportSession()).toBeNull();
  });
});
