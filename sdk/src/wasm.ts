/** Lazy loader for the proof wasm (built by scripts/build_wasm.sh into sdk/wasm). */
import type * as Wasm from "../wasm/window_proofs.js";

let mod: Promise<typeof Wasm> | null = null;

export function proofs(): Promise<typeof Wasm> {
  if (!mod) {
    mod = import("../wasm/window_proofs.js").then(async (m) => {
      await m.default();
      return m;
    });
  }
  return mod;
}
