import * as sdk from "@thewindow/solana-sdk";
import { describe, expect, it } from "vitest";
import { RECIPES, type RecipeCtx } from "./recipes";

const ctx = {
  sdk,
  config: {
    rpcUrl: "https://rpc.example",
    wsUrl: "wss://rpc.example",
    adminUrl: "",
    cluster: "devnet",
    source: { rpc: "default", admin: "default", ws: "default" },
  },
  wallet: "HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6",
  memberSignature: null,
  deployment: null,
  signal: new AbortController().signal,
  log: () => {},
} as unknown as RecipeCtx;

describe("recipes", () => {
  it("name in their code every SDK function their run calls, and those functions exist", () => {
    for (const r of RECIPES) {
      const code = r.code(ctx);
      const called = new Set(Array.from(r.run.toString().matchAll(/sdk\.(\w+)/g), (m) => m[1] as string));
      expect(code, r.id).toContain("sdk.");
      for (const name of called) {
        expect(code, `${r.id}: ${name} missing from the snippet`).toContain(`sdk.${name}`);
        expect(name in sdk, `${r.id}: sdk.${name} does not exist`).toBe(true);
      }
    }
  });

  it("have unique ids and lead with the RPC they run against", () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const r of RECIPES) expect(r.code(ctx)).toMatch(/rpc\.example/);
  });
});
