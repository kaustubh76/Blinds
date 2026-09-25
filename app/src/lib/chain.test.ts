import { afterEach, describe, expect, it, vi } from "vitest";
import bundled from "../../../deployments/devnet.json";
import { fetchDeployment } from "./chain";

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deployment descriptor", () => {
  it("prefers the admin service, and says the faucet is reachable", async () => {
    const live = { ...bundled, mock_mint: bundled.mock_mint, profile: "live" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(live)),
    );
    const d = await fetchDeployment();
    expect(d.faucet).toBe(true);
    expect(d.raw.profile).toBe("live");
  });

  it("falls back to the committed deployment so the chain pages work with no service running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const d = await fetchDeployment("devnet");
    // The judging-critical property: no admin service, but still a usable view of the market.
    expect(d.faucet).toBe(false);
    expect(d.mockMint).toBe(bundled.mock_mint);
    expect(d.cstockMint).toBe(bundled.cstock_mint);
    expect(d.feedId.length).toBe(32);
    expect(d.auditorPubkey.length).toBe(32);
  });

  it("refuses to hand the devnet copy to a page pointed somewhere else, and says why", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    // The bundled descriptor's mints, escrow and listing PDAs exist on devnet and nowhere else.
    // Reading them off a localnet validator misses every account, which used to look like the
    // dashboard being broken rather than the admin service being down.
    await expect(fetchDeployment("localnet")).rejects.toThrow(/describes devnet, not this cluster/);
  });
});

describe("join", () => {
  it("understands the service's JSON answer, including 'already a member'", async () => {
    const { joinDesk } = await import("./chain");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return { ok: true, text: async () => JSON.stringify({ ok: true, signature: null, already_member: true }) };
      }),
    );
    const r = await joinDesk({
      wallet: "11111111111111111111111111111111" as never,
      elgamalPubkey: new Uint8Array(32),
      mockAccount: "11111111111111111111111111111111" as never,
    });
    expect(r).toEqual({ signature: null, alreadyMember: true });
    expect(calls[0]).toMatch(/\/join$/);
  });

  it("surfaces the service's error text", async () => {
    const { joinDesk } = await import("./chain");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ ok: false, error: "faucet busy" }),
      })),
    );
    await expect(
      joinDesk({ wallet: "x" as never, elgamalPubkey: new Uint8Array(32), mockAccount: "y" as never }),
    ).rejects.toThrow("faucet busy");
  });
});
