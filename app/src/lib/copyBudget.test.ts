import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isProse, MAX_RUN, overBudget } from "./copyBudget";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !name.includes(".test.") && !name.startsWith("copyBudget")) out.push(p);
  }
  return out;
}

describe("copy budget", () => {
  it("knows prose from code", () => {
    expect(isProse("The keeper posts a mark and the chain bounds its age at 48 hours")).toBe(true);
    expect(isProse("const plan = await sdk.buildBidPlan({ member: signer });")).toBe(false);
    expect(isProse("mt-3 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-ink-3")).toBe(false);
    expect(isProse("getMinimumBalanceForRentExemption")).toBe(false);
    expect(isProse("")).toBe(false);
  });

  it("finds a run over the budget and ignores one under it", () => {
    const long = `<p>${"the keeper posts a mark and the chain bounds it ".repeat(6)}</p>`;
    expect(overBudget(long)).toHaveLength(1);
    expect(overBudget("<p>the keeper posts a mark and the chain bounds its age</p>")).toEqual([]);
  });

  it("ignores a long run inside a block comment, because a reader never sees it", () => {
    const doc = `/** ${"this is a long house comment explaining the mechanism at length ".repeat(4)} */`;
    expect(overBudget(doc)).toEqual([]);
  });

  /**
   * The rule itself: the UI states facts in lines. Anything needing a paragraph goes in `docs/` and is
   * linked with `DocLink` — see `components/ui.tsx`.
   */
  it("no dashboard source file renders a paragraph", () => {
    const offenders = walk(join(import.meta.dirname, ".."))
      .map((f) => [f.split("/src/")[1] ?? f, overBudget(readFileSync(f, "utf8"))] as const)
      .filter(([, hits]) => hits.length > 0)
      .map(([f, hits]) => `${f}: ${hits.map((h) => `${h.length}c "${h.text.slice(0, 70)}…"`).join(" | ")}`);
    expect(offenders, `over ${MAX_RUN} characters — shorten it, or move it to docs/ and link with DocLink`).toEqual([]);
  });
});
