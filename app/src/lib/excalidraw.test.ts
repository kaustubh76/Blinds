/**
 * docs/tracks.excalidraw (scripts/tracks_diagram.mjs) and docs/project.excalidraw (scripts/project_diagram.mjs) are
 * generated; every binding in each must point at a real element, and the whole-product map must badge what it names.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_CLAIMS } from "./honestClaims";

const here = dirname(fileURLToPath(import.meta.url));
type Element = {
  id: string;
  type: string;
  isDeleted: boolean;
  groupIds?: string[];
  containerId?: string | null;
  boundElements?: Array<{ id: string; type: string }>;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  text?: string;
};
type File = { type: string; version: number; elements: Element[] };
const load = (name: string) => JSON.parse(readFileSync(join(here, "../../../docs", name), "utf8")) as File;
const tracks = load("tracks.excalidraw");
const project = load("project.excalidraw");

describe.each([
  ["tracks.excalidraw", tracks],
  ["project.excalidraw", project],
] as const)("docs/%s", (_name, file) => {
  const ids = new Set(file.elements.map((e) => e.id));

  it("is an Excalidraw v2 file with unique element ids", () => {
    expect(file.type).toBe("excalidraw");
    expect(file.version).toBe(2);
    expect(ids.size).toBe(file.elements.length);
    expect(file.elements.some((e) => e.isDeleted)).toBe(false);
  });

  it("binds every arrow, label and bound element to an existing element", () => {
    for (const e of file.elements) {
      if (e.type === "arrow") {
        expect(e.startBinding && ids.has(e.startBinding.elementId), `${e.id} start`).toBe(true);
        expect(e.endBinding && ids.has(e.endBinding.elementId), `${e.id} end`).toBe(true);
      }
      if (e.containerId) expect(ids.has(e.containerId), `${e.id} container`).toBe(true);
      for (const b of e.boundElements ?? []) expect(ids.has(b.id), `${e.id} bound ${b.id}`).toBe(true);
    }
  });
});

describe("docs/tracks.excalidraw", () => {
  it("names the two tracks and the four stages", () => {
    const text = tracks.elements.map((e) => e.text ?? "").join("\n");
    for (const needle of ["Pyth", "PreStocks", "①", "②", "③", "④", "max_publish_age"]) {
      expect(text).not.toContain("Tessera");
      expect(text, needle).toContain(needle);
    }
  });
});

describe("docs/project.excalidraw", () => {
  const text = project.elements.map((e) => e.text ?? "").join("\n");
  // a box, its text and its status pill share a group; the pill's word is the box's status
  const groupText = new Map<string, string>();
  for (const e of project.elements)
    for (const g of e.groupIds ?? []) groupText.set(g, `${groupText.get(g) ?? ""}\n${e.text ?? ""}`);
  const contexts = (needle: string) =>
    project.elements
      .filter((e) => e.text?.includes(needle))
      .map((e) => `${e.text}\n${e.groupIds?.[0] ? groupText.get(e.groupIds[0]) : ""}`);

  it("names the five programs, the rate and the proofs", () => {
    for (const n of [
      "window_registry",
      "window_auction",
      "window_oracle",
      "window_wrap",
      "window_credit",
      "xONIA",
      "PoCD",
      "E_Δ",
    ])
      expect(text, n).toContain(n);
  });

  it("carries every status badge", () => {
    for (const w of ["LIVE", "BUILT · gated", "RETIRED", "DROPPED", "ROADMAP", "CORE"]) expect(text, w).toContain(w);
    expect(text).toMatch(/IN PROGRESS|PLANNED/);
  });

  it("mentions Tessera only as retired or dropped, and Meteora / Clawpump only with a computed status", () => {
    expect(contexts("Tessera").length).toBeGreaterThan(0);
    for (const c of contexts("Tessera")) expect(c).toMatch(/RETIRED|DROPPED/);
    for (const n of ["Meteora", "Clawpump"]) {
      expect(contexts(n).length).toBeGreaterThan(0);
      for (const c of contexts(n)) expect(c).toMatch(/PLANNED|IN PROGRESS|BUILT|LIVE/);
    }
  });

  it("never asserts a forbidden claim (spec §14)", () => {
    // The same list the dashboard's own guard uses — a second copy here would be one more thing to drift
    // (and honestClaims.test.ts would flag this file for carrying the phrases).
    expect(text).not.toMatch(new RegExp(FORBIDDEN_CLAIMS.join("|"), "i"));
  });
});
