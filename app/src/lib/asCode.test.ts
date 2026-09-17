import { describe, expect, it } from "vitest";
import { asCode, hexPreview, renderValue } from "./asCode";

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

describe("asCode", () => {
  it("renders live values in copyable TypeScript", () => {
    const code = asCode("buildBidPlan", {
      member: { address: "HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6", modifyAndSignTransactions: () => {} },
      epoch: 31n,
      side: 1,
      tick: 8,
      sizeMicroUsdc: 1_000_000_000n,
      auditorPubkey: bytes(32, 7),
      mint: "HspLRQqDkAjw2Dt6inJS6GrBHhuNfgHWtYtH9mMTzJpn",
      rent: async () => 0n,
    });
    expect(code).toContain("await sdk.buildBidPlan({");
    expect(code).toContain("epoch: 31n,");
    expect(code).toContain("sizeMicroUsdc: 1000000000n,");
    expect(code).toContain('mint: address("HspLRQqDkAjw2Dt6inJS6GrBHhuNfgHWtYtH9mMTzJpn")');
    expect(code).toContain("member: signer /* your wallet");
    expect(code).toContain(`auditorPubkey: hex("${hexPreview(bytes(32, 7))}") /* 32 bytes */`);
    expect(code).toContain("rent: fn,");
  });

  it("never lets a secret through, by key, before rendering", () => {
    const secret = bytes(64, 3);
    const opening = bytes(32, 9);
    const code = asCode("buildLockPlan", {
      signature: secret,
      loanOpening: opening,
      nested: { opening, sk: "deadbeef" },
    });
    const hex = Array.from(secret, (x) => x.toString(16).padStart(2, "0")).join("");
    const ohex = Array.from(opening, (x) => x.toString(16).padStart(2, "0")).join("");
    for (let i = 0; i + 8 <= hex.length; i += 2) expect(code).not.toContain(hex.slice(i, i + 8));
    for (let i = 0; i + 8 <= ohex.length; i += 2) expect(code).not.toContain(ohex.slice(i, i + 8));
    expect(code).not.toContain("deadbeef");
    expect(code).toContain("never logged");
  });

  it("previews bytes without dumping them", () => {
    expect(hexPreview(new Uint8Array([1, 2, 3]))).toBe("010203");
    expect(renderValue(new Uint8Array(100))).toMatch(/^hex\("00000000…0000"\) \/\* 100 bytes \*\/$/);
  });
});
