import { describe, expect, it } from "vitest";
import { isTransientRpcError } from "../src/send.js";

describe("which RPC failures are worth retrying", () => {
  it("counts a rate limit however @solana/kit dresses it", () => {
    expect(isTransientRpcError({ context: { statusCode: 429 } })).toBe(true);
    expect(isTransientRpcError({ context: { statusCode: 503 } })).toBe(true);
    // The kit reports an HTTP failure as error 8100002; the message never says 429.
    expect(isTransientRpcError(new Error("Solana error #8100002; Decode this error by running …"))).toBe(true);
    expect(isTransientRpcError({ context: { __code: 8100002 } })).toBe(true);
    expect(isTransientRpcError(new Error("fetch failed"))).toBe(true);
    expect(isTransientRpcError({ cause: { context: { statusCode: 429 } } })).toBe(true);
  });
  it("does not retry a real answer from the chain", () => {
    expect(isTransientRpcError(new Error("custom program error: 0x1786 (DeltaMismatch)"))).toBe(false);
    expect(isTransientRpcError(new Error("not a DBC pool account"))).toBe(false);
    expect(isTransientRpcError(null)).toBe(false);
  });
});
