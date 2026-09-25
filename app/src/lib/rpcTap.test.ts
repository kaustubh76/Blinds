import { describe, expect, it } from "vitest";
import { MAX_CALLS, rpcTap, tapTransport } from "./rpcTap";

const URL_ = "http://127.0.0.1:8899";
const payload = (method: string, params: unknown) => ({ jsonrpc: "2.0", id: "1", method, params });

describe("rpcTap", () => {
  it("records nothing until it is started", async () => {
    const t = tapTransport(async () => ({ result: 1 }) as never, URL_);
    await t({ payload: payload("getSlot", []) });
    expect(rpcTap.peek()).toHaveLength(0);
  });

  it("records the method, the params and how long it took", async () => {
    const t = tapTransport(async () => ({ result: 42 }) as never, URL_);
    rpcTap.start();
    await t({ payload: payload("getSlot", [{ commitment: "confirmed" }]) });
    const calls = rpcTap.stop();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("getSlot");
    expect(calls[0]?.params).toEqual([{ commitment: "confirmed" }]);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.ms).toBeGreaterThanOrEqual(0);
    expect(calls[0]?.bytes).toBeGreaterThan(0);
  });

  it("records a failure and still rethrows it", async () => {
    const t = tapTransport(async () => {
      throw new Error("429 Too Many Requests");
    }, URL_);
    rpcTap.start();
    await expect(t({ payload: payload("getSlot", []) })).rejects.toThrow("429");
    const calls = rpcTap.stop();
    expect(calls[0]?.ok).toBe(false);
    expect(calls[0]?.error).toContain("429");
  });

  it("is bounded: the oldest calls fall off", async () => {
    const t = tapTransport(async () => ({ result: 1 }) as never, URL_);
    rpcTap.start();
    for (let i = 0; i < MAX_CALLS + 20; i++) await t({ payload: payload(`m${i}`, []) });
    const calls = rpcTap.stop();
    expect(calls).toHaveLength(MAX_CALLS);
    expect(calls[0]?.method).toBe("m20");
  });

  it("renders a curl that reproduces the call, with a fresh id", () => {
    const curl = rpcTap.asCurl(
      { id: 7, method: "getAccountInfo", params: ["abc", { encoding: "base64" }], ms: 3, ok: true, bytes: 0 },
      URL_,
    );
    expect(curl).toContain(`curl -s ${URL_}`);
    expect(curl).toContain("-X POST");
    expect(curl).toContain('"method":"getAccountInfo"');
    expect(curl).toContain('"id":1');
    expect(curl).toContain('"encoding":"base64"');
  });

  it("renders a bigint parameter rather than throwing on it", () => {
    // The whole reason this exists: `JSON.stringify` refuses a bigint, and that throw happened inside
    // the inspector's render, where React's boundary replaced the entire page with the error screen.
    const curl = rpcTap.asCurl(
      {
        id: 1,
        method: "getMinimumBalanceForRentExemption",
        params: [8n, { commitment: "confirmed" }],
        ms: 1,
        ok: true,
        bytes: 0,
      },
      URL_,
    );
    expect(curl).toContain('"params":[8,{"commitment":"confirmed"}]');
  });

  it("says so rather than lying when a number is too large for JSON", () => {
    const curl = rpcTap.asCurl({ id: 1, method: "x", params: [2n ** 70n], ms: 0, ok: true, bytes: 0 }, URL_);
    expect(curl).toContain("1180591620717411303424");
    expect(curl).toContain("too large for JSON");
  });

  it("measures the size of a response holding a bigint instead of reporting zero", async () => {
    const t = tapTransport(async () => ({ result: { slot: 12345678901n } }) as never, URL_);
    rpcTap.start();
    await t({ payload: payload("getSlot", []) });
    expect(rpcTap.stop()[0]?.bytes).toBeGreaterThan(0);
  });

  it("escapes a single quote so the shell cannot be broken out of", () => {
    const curl = rpcTap.asCurl({ id: 1, method: "x", params: ["it's"], ms: 0, ok: true, bytes: 0 }, URL_);
    expect(curl).not.toMatch(/-d 'it's/);
    expect(curl).toContain(`'\\''`);
  });

  it("starting again discards the previous recording", async () => {
    const t = tapTransport(async () => ({ result: 1 }) as never, URL_);
    rpcTap.start();
    await t({ payload: payload("first", []) });
    rpcTap.start();
    await t({ payload: payload("second", []) });
    const calls = rpcTap.stop();
    expect(calls.map((c) => c.method)).toEqual(["second"]);
  });
});
