import { describe, expect, it } from "vitest";
import type { LaunchRecord } from "../../lib/launch";
import { journey, LAUNCH_KEY } from "./journey";

const devnet = {
  cluster: "devnet",
  pool: "EZyMqXWBk5Z5jLnrZJ1NM8AseSmFaRvn2XSKZSrv6BTg",
  baseMint: "72QJmsn48nkLKM6zDr5hjVvoEuJGrRRtS81iv8geZL1m",
  agent: {
    id: "0044b672",
    walletAddress: "39VKQn2Skp67mFYfiFfvRLEKsxaTtHqQWRop5q9cA7sM",
    name: "The Window Lender",
    status: "running",
  },
} as unknown as LaunchRecord;

describe("the lender agent's journey", () => {
  it("with only the devnet record: identity and rehearsal done, mainnet and the coin wait on SOL, graduation pending", () => {
    const s = journey(devnet, null, { isMigrated: false, progress: 0.029 });
    expect(s.map((x) => [x.id, x.state])).toEqual([
      ["identity", "done"],
      ["rehearsal", "done"],
      ["mainnet", "blocked"],
      ["coin", "blocked"],
      ["graduation", "pending"],
    ]);
    expect(s[2]?.detail).toContain(`${LAUNCH_KEY.slice(0, 4)}…`);
    expect(s[3]?.detail).toContain("39VK");
    expect(s[4]?.detail).toContain("2.9 %");
  });
  it("with no identity the coin is merely pending, not blocked on a wallet", () => {
    const s = journey({ ...devnet, agent: undefined } as unknown as LaunchRecord, null, null);
    expect(s[0]?.state).toBe("pending");
    expect(s[3]).toMatchObject({ state: "pending", detail: "needs the identity first" });
    expect(s[4]?.detail).toContain("once the pool reads");
  });
  it("with the mainnet record and the coin everything but graduation is done, and a migrated pool completes it", () => {
    const mainnet = {
      ...devnet,
      cluster: "mainnet",
      pool: "PooL1111111111111111111111111111111111111111",
      clawpump: {
        symbol: "LENDER",
        mint: "MinT1111111111111111111111111111111111111111",
        pumpUrl: "https://pump.fun/coin/x",
      },
    } as unknown as LaunchRecord;
    const s = journey(devnet, mainnet, { isMigrated: false, progress: 0.5 });
    expect(s.filter((x) => x.state === "done")).toHaveLength(4);
    expect(s[3]?.href).toBe("https://pump.fun/coin/x");
    expect(journey(devnet, mainnet, { isMigrated: true, progress: 1 }).every((x) => x.state === "done")).toBe(true);
  });

  it("counts a pool that already graduated on this cluster, and says the live one is a new curve", () => {
    const withPast = {
      ...devnet,
      previousGraduation: {
        pool: "EZyMqXWBk5Z5jLnrZJ1NM8AseSmFaRvn2XSKZSrv6BTg",
        dammPool: "BYmPeXgRzK5Apaf6J4MMEmJyJou8Xnz5FK4794ep3XKe",
        tx: "uBG36giq",
        at: "2026-09-23T05:04:33.156Z",
      },
    } as unknown as LaunchRecord;
    const s = journey(withPast, null, { isMigrated: false, progress: 0.03 });
    const grad = s.find((x) => x.id === "graduation");
    expect(grad?.state).toBe("done");
    expect(grad?.detail).toContain("migrated");
    expect(grad?.detail).toContain("the pool above is the live one");
    expect(grad?.href).toContain("BYmPeXgR");
  });

  it("says how Clawpump reports the agent", () => {
    const s = journey(devnet, null, null);
    expect(s[0]?.detail).toContain("running on Clawpump");
    const stopped = { ...devnet, agent: { ...devnet.agent, status: "stopped" } } as unknown as LaunchRecord;
    expect(journey(stopped, null, null)[0]?.detail).toContain("status stopped");
  });
});
