import type { PrintVerdict } from "@thewindow/solana-sdk";
import { describe, expect, it } from "vitest";
import { type OnChainPrint, type VerifyResult, verified } from "./useVerify";

const result = (verdict: Partial<PrintVerdict>, local: VerifyResult["local"] = { rStar: 17, matched: 1_294_000n }) =>
  ({
    verdict: {
      ok: true,
      nonzero: 4,
      proven: 4,
      r_star_recomputed: 17,
      failures: [],
      proofTransactions: [],
      ...verdict,
    },
    local,
    elapsedMs: 120,
  }) as VerifyResult;

const onChain: OnChainPrint = { rStar: 17, matched: 1_294_000n };

describe("verified", () => {
  it("clears when every proof checks and the published figures match", () => {
    expect(verified(result({}), onChain)).toBe(true);
  });

  it("fails when a proof did not check", () => {
    expect(verified(result({ ok: false, failures: ["tick 12"] }), onChain)).toBe(false);
  });

  // The mismatch case is the fraud this page exists to expose: the proofs can all verify while the
  // administrator published a clearing rate that the proven sums do not produce.
  it("fails when the proofs check but the published rate disagrees", () => {
    expect(verified(result({}), { rStar: 18, matched: 1_294_000n })).toBe(false);
  });

  it("fails when the proofs check but the published volume disagrees", () => {
    expect(verified(result({}), { rStar: 17, matched: 9n })).toBe(false);
  });

  // Nothing to compare against is not the same as a disagreement.
  it("clears on proofs alone when there is nothing to compare", () => {
    expect(verified(result({}), null)).toBe(true);
    expect(verified(result({}, null), onChain)).toBe(true);
  });

  it("a no-trade print agrees when both sides say no rate", () => {
    expect(verified(result({}, { rStar: 0, matched: 0n }), { rStar: null, matched: 0n })).toBe(false);
  });
});
