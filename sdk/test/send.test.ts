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

describe("wordings that used to reach a caller as a hard failure", () => {
  // Each of these was observed rather than imagined: reqwest's phrasing from the Rust services'
  // 2026-09-24 storm, and the shapes a provider endpoint fails with while it is coming up.
  it.each([
    "error sending request for url (https://api.devnet.solana.com/)",
    "getaddrinfo ENOTFOUND rpc.example.com",
    "getaddrinfo EAI_AGAIN rpc.example.com",
    "503 Service Unavailable",
    "502 Bad Gateway",
    "504 Gateway Timeout",
    "rate limit exceeded",
  ])("treats %s as transient", (message) => {
    expect(isTransientRpcError(new Error(message))).toBe(true);
  });

  it("still refuses to retry something the cluster decided", () => {
    expect(isTransientRpcError(new Error("custom program error: 0x1791"))).toBe(false);
    expect(isTransientRpcError(new Error("Blockhash not found"))).toBe(false);
  });
});
