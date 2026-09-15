import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_CLAIMS, findForbiddenClaims } from "./honestClaims";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|html)$/.test(name) && !name.startsWith("honestClaims")) out.push(p);
  }
  return out;
}

describe("honest claims (spec §14)", () => {
  it("flags the forbidden phrases", () => {
    for (const c of FORBIDDEN_CLAIMS) expect(findForbiddenClaims(`this is ${c.toUpperCase()} stuff`)).toContain(c);
    expect(findForbiddenClaims("the administrator sees every bid in plaintext")).toEqual([]);
  });
  it("no dashboard source file makes a forbidden claim", () => {
    const src = join(import.meta.dirname, "..");
    const offenders = walk(src)
      .map((f) => [f, findForbiddenClaims(readFileSync(f, "utf8"))] as const)
      .filter(([, hits]) => hits.length > 0);
    expect(offenders).toEqual([]);
  });
});
