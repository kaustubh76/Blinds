import { describe, expect, it, vi } from "vitest";
import {
  agentFields,
  clawpump,
  describe402,
  launchBody,
  newAgentFields,
  pickAgent,
  TSLAX_MINT,
} from "../src/clawpump.js";

const agent = (id: string, name: string) => ({ id, name, walletAddress: `${id}wallet` });

describe("which Clawpump agent is the lender", () => {
  it("reuses the account's only agent, renamed later by the caller", () => {
    expect(pickAgent([agent("a", "Blinds")], undefined, false)).toEqual({
      action: "update",
      agent: agent("a", "Blinds"),
    });
  });
  it("needs an explicit id once there are several, and honours it", () => {
    const two = [agent("a", "Blinds"), agent("b", "Other")];
    expect(() => pickAgent(two, undefined, false)).toThrow(/CLAWPUMP_AGENT_ID/);
    expect(pickAgent(two, "b", false)).toEqual({ action: "update", agent: agent("b", "Other") });
    expect(() => pickAgent(two, "zzz", false)).toThrow(/not an agent of this key/);
  });
  it("creates when there is none, or when asked to", () => {
    expect(pickAgent([], undefined, false)).toEqual({ action: "create" });
    expect(pickAgent([agent("a", "Blinds")], undefined, true)).toEqual({ action: "create" });
  });
});

describe("the stock-paired launch body", () => {
  const ok = {
    agentId: "a",
    name: "The Window Lender",
    symbol: "LENDER",
    description: "The identity coin of THE WINDOW's lender agent, paired with TSLAx.",
    imageUrl: "https://kaustubh76.github.io/Blinds/launch/lender.png",
    quoteMint: TSLAX_MINT,
    creatorFeeBps: 100,
  };
  it("pairs with TSLAx, is paid by the agent's wallet, and buys nothing itself", () => {
    expect(launchBody(ok)).toMatchObject({
      pumpQuoteMint: TSLAX_MINT,
      pumpCreatorFeeBps: 100,
      selfFunded: true,
      initialBuySol: 0,
    });
    expect(launchBody(ok)).not.toHaveProperty("twitter");
  });
  it("refuses what the API would refuse, before any call", () => {
    expect(() => launchBody({ ...ok, symbol: "TOOLONGSYMBOL" })).toThrow(/symbol/);
    expect(() => launchBody({ ...ok, description: "short" })).toThrow(/description/);
    expect(() => launchBody({ ...ok, imageUrl: "http://x" })).toThrow(/https/);
    expect(() => launchBody({ ...ok, creatorFeeBps: 50 })).toThrow(/100–300/);
  });
});

describe("the API call", () => {
  it("carries the request id and turns a 402 into guidance, never logging the key", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe("Bearer cpk_test");
      return new Response(
        JSON.stringify({ error: "payment_required", guidance: { fund: "0.0092 SOL" }, meta: { requestId: "req-1" } }),
        { status: 402 },
      );
    }) as unknown as typeof fetch;
    await expect(clawpump("cpk_test", "POST", "/launch", {}, 1000, fetchImpl)).rejects.toMatchObject({
      status: 402,
      requestId: "req-1",
    });
    const err = await clawpump("cpk_test", "POST", "/launch", {}, 1000, fetchImpl).catch((e) => e);
    expect(describe402(err.body)).toContain("payment_required");
    expect(describe402(err.body)).toContain("0.0092 SOL");
    expect(String(err.message)).not.toContain("cpk_test");
  });
  it("returns the parsed body on success", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ agents: [], meta: { requestId: "r2" } }), {
        status: 200,
      })) as unknown as typeof fetch;
    const r = await clawpump<{ agents: unknown[] }>("cpk_test", "GET", "/agents", undefined, 1000, fetchImpl);
    expect(r.data.agents).toEqual([]);
    expect(r.requestId).toBe("r2");
  });
});

describe("the agent's identity fields", () => {
  const img = "https://kaustubh76.github.io/Blinds/launch/lender.png";
  it("updates with what the API allows — snake_case, no persona", () => {
    const f = agentFields("The Window Lender", img);
    expect(f).toEqual({
      name: "The Window Lender",
      avatar_url: img,
      is_public: true,
      skills: ["token-launch", "wallet", "portfolio", "market-intelligence", "trading"],
    });
    expect(f).not.toHaveProperty("persona"); // "No allowed fields in request body" on an update
    expect(f).not.toHaveProperty("avatarUrl");
  });
  it("carries the persona only where creation accepts it", () => {
    expect(newAgentFields("The Window Lender", img)).toMatchObject({
      persona: expect.stringContaining("autonomous lender"),
    });
  });
  it("refuses a skill slug Clawpump does not know (this is what dropped the first update)", () => {
    expect(() => agentFields("x", img, ["solana"])).toThrow(/not Clawpump skill slugs: solana/);
  });
});

describe("the Clawpump cost quote", () => {
  it("is read from the API, never assumed", async () => {
    const fetchImpl = (async (url: string | URL) => {
      expect(String(url)).toContain("/launch/self-funded?quoteMint=XsDoVfqe");
      return new Response(JSON.stringify({ creationFeeSol: 0.009218, payTo: "49CfXAr5", meta: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await clawpump<{ creationFeeSol: number; payTo: string }>(
      "cpk_test",
      "GET",
      `/launch/self-funded?quoteMint=${TSLAX_MINT}`,
      undefined,
      1000,
      fetchImpl,
    );
    expect(r.data.creationFeeSol).toBe(0.009218);
    expect(r.data.payTo).toBe("49CfXAr5");
  });
});
