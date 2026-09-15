// Generates TypeScript clients (@solana/kit style) from the frozen Anchor IDLs in sdk/idl.
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type AnchorIdl, rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";

const programs = ["window_registry", "window_auction", "window_oracle", "window_wrap", "window_credit"];
const out = join(import.meta.dirname, "..", "src", "generated");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of programs) {
  const idl = JSON.parse(readFileSync(join(import.meta.dirname, "..", "idl", `${p}.json`), "utf8")) as AnchorIdl;
  const codama = createFromRoot(rootNodeFromAnchor(idl));
  const tmp = join(out, `${p}.tmp`);
  await codama.accept(renderVisitor(tmp, { formatCode: false }));
  // the renderer lays out a package (src/generated/...); keep only the code
  renameSync(join(tmp, "src", "generated"), join(out, p));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`generated ${p}`);
}
