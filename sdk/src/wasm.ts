/**
 * Lazy loader for the proof wasm (built by scripts/build_wasm.sh into sdk/wasm). Imported through
 * the package's own `./wasm` export so bundlers keep the `.wasm` asset next to the glue module.
 */
import type * as Wasm from "../wasm/window_proofs.js";

let mod: Promise<typeof Wasm> | null = null;

export function proofs(): Promise<typeof Wasm> {
  if (!mod) {
    mod = import("@thewindow/solana-sdk/wasm").then(async (m) => {
      await m.default();
      return m;
    });
  }
  return mod;
}
