/**
 * Lazy loader for the proof wasm (built by scripts/build_wasm.sh into sdk/wasm). Imported through
 * the package's own `./wasm` export so bundlers keep the `.wasm` asset next to the glue module.
 * In Node (tests, scripts) the bytes are read from disk because `fetch` has no `file:` support.
 */
import type * as Wasm from "../wasm/window_proofs.js";

let mod: Promise<typeof Wasm> | null = null;

const isNode = typeof process !== "undefined" && !!process.versions?.node && typeof window === "undefined";

async function load(): Promise<typeof Wasm> {
  const m = await import("@thewindow/solana-sdk/wasm");
  if (isNode) {
    const fsModule = "node:fs/promises";
    const fs = (await import(/* @vite-ignore */ fsModule)) as typeof import("node:fs/promises");
    // dist/index.js and src/wasm.ts are both siblings of wasm/; keep the path out of static analysis.
    const rel = "../wasm/window_proofs_bg.wasm";
    const bytes = await fs.readFile(new URL(rel, import.meta.url));
    await m.default({ module_or_path: bytes });
  } else {
    await m.default();
  }
  return m;
}

export function proofs(): Promise<typeof Wasm> {
  if (!mod) mod = load();
  return mod;
}
