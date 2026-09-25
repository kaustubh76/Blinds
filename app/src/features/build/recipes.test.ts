import * as sdk from "@thewindow/solana-sdk";
import { describe, expect, it } from "vitest";
import { defaultValues, makeParams, type ParamSpec, RECIPES, type Recipe, type RecipeCtx } from "./recipes";

const base = {
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
  desk: null,
  dryRun: true,
};

/** The context a recipe is rendered with: its own parameters, at the values given (defaults if none). */
const ctxFor = (r: Recipe, values: Record<string, string> = defaultValues(r.params)): RecipeCtx =>
  ({ ...base, p: makeParams(r.params, values) }) as unknown as RecipeCtx;

/** A value for a spec that differs from its default, so a snippet that ignores it can be caught. */
function otherValue(sp: ParamSpec, ctx: RecipeCtx): string {
  switch (sp.kind) {
    case "int":
      return String(Math.min(sp.max ?? 7, Math.max(sp.min ?? 0, Number(sp.default) === 7 ? 5 : 7)));
    case "usdc":
      return String(Number(sp.default) === 4321 ? 1234 : 4321);
    // A text field's value may be rejected as malformed (an address, an epoch), in which case the
    // recipe falls back and the snippet would not change — so the spec names a value known to be good.
    case "text":
      return sp.example ?? "987654";
    case "choice": {
      const other = sp.choices(ctx).find((c) => c.value !== sp.default);
      return other?.value ?? String(sp.default);
    }
  }
}

describe("recipes", () => {
  it("name in their code every SDK function their run calls, and those functions exist", () => {
    for (const r of RECIPES) {
      const code = r.code(ctxFor(r));
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
    for (const r of RECIPES) {
      // The lender agent's pool lives on the launch's own cluster, not the desk's; that recipe names
      // the endpoint it really reads, which after a mainnet launch is a mainnet one.
      if (r.id === "launch-status") {
        expect(r.code(ctxFor(r))).toMatch(/createSolanaRpc\("https?:\/\//);
        continue;
      }
      expect(r.code(ctxFor(r)), r.id).toMatch(/rpc\.example/);
    }
  });

  it("declare parameters with unique keys and a default of the right shape", () => {
    for (const r of RECIPES) {
      if (!r.params) continue;
      expect(new Set(r.params.map((p) => p.key)).size, r.id).toBe(r.params.length);
      for (const sp of r.params) {
        if (sp.kind === "int" || sp.kind === "usdc") expect(typeof sp.default, `${r.id}.${sp.key}`).toBe("number");
        else expect(typeof sp.default, `${r.id}.${sp.key}`).toBe("string");
        if (sp.kind === "choice")
          expect(sp.choices(ctxFor(r)).length, `${r.id}.${sp.key} offers no choices`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The point of declaring a parameter: the snippet has to follow it. A recipe that renders a literal
   * where its own dial should be shows a developer code that does not match what it just ran.
   */
  it("render a different snippet when a parameter changes", () => {
    for (const r of RECIPES) {
      if (!r.params?.length) continue;
      const ctx = ctxFor(r);
      for (const sp of r.params) {
        const changed = { ...defaultValues(r.params), [sp.key]: otherValue(sp, ctx) };
        if (changed[sp.key] === String(sp.default)) continue; // a one-choice parameter has nothing to vary
        expect(r.code(ctxFor(r, changed)), `${r.id}: the snippet ignores ${sp.key}`).not.toBe(r.code(ctx));
      }
    }
  });

  it("mark as writing exactly those recipes that go through the desk", () => {
    for (const r of RECIPES) {
      const usesDesk = /ctx\.desk\./.test(r.run.toString());
      expect(!!r.writes, `${r.id}: writes=${!!r.writes} but ${usesDesk ? "uses" : "does not use"} ctx.desk`).toBe(
        usesDesk,
      );
      // Anything that writes needs a key or a wallet before it can be reached at all.
      if (r.writes) expect(r.needs, `${r.id} writes without a gate`).toBeTruthy();
    }
  });

  it("read parameters through ctx.p rather than holding literals", () => {
    for (const r of RECIPES) {
      if (!r.params?.length) continue;
      const src = `${r.run.toString()}${r.code.toString()}`;
      for (const sp of r.params) expect(src, `${r.id}: ${sp.key} is declared but never read`).toContain(`"${sp.key}"`);
    }
  });
});

describe("makeParams", () => {
  const specs: ParamSpec[] = [
    { key: "n", kind: "int", label: "n", default: 8, min: 0, max: 36 },
    { key: "amount", kind: "usdc", label: "amount", default: 1000 },
    { key: "who", kind: "text", label: "who", default: "" },
  ];
  const p = (values: Record<string, string>) => makeParams(specs, values);

  it("falls back to the default when a field is blank or unparseable", () => {
    expect(p({}).int("n")).toBe(8);
    expect(p({ n: "" }).int("n")).toBe(8);
    expect(p({ n: "abc" }).int("n")).toBe(8);
  });

  it("clamps an int to the spec's range rather than sending it on", () => {
    expect(p({ n: "99" }).int("n")).toBe(36);
    expect(p({ n: "-5" }).int("n")).toBe(0);
    expect(p({ n: "12" }).int("n")).toBe(12);
  });

  it("turns whole USDC into micro-USDC", () => {
    expect(p({ amount: "1" }).big("amount")).toBe(1_000_000n);
    expect(p({ amount: "2500" }).big("amount")).toBe(2_500_000_000n);
    expect(p({ amount: "" }).big("amount")).toBe(1_000_000_000n);
  });

  it("never returns a negative size", () => {
    expect(p({ amount: "-7" }).big("amount")).toBe(0n);
  });

  it("hands text back as typed, and reports every value together", () => {
    expect(p({ who: " abc " }).str("who")).toBe(" abc ");
    expect(p({ n: "3", amount: "5", who: "x" }).all()).toEqual({ n: "3", amount: "5", who: "x" });
  });

  it("answers for an undeclared key without throwing", () => {
    expect(p({}).str("nope")).toBe("");
    expect(p({}).int("nope")).toBe(0);
    expect(p({}).big("nope")).toBe(0n);
  });
});
