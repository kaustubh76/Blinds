// `pnpm dev` runs this first: the app imports @thewindow/solana-sdk from sdk/dist, which is git-ignored,
// so a stale or missing build silently drops whole cards (the lender agent's needs fetchDbc/dbcFeeAt).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "sdk/dist/index.js");
const hint = "run: pnpm --filter @thewindow/solana-sdk build   (docs/DEMO.md → Quickstart)";
if (!existsSync(dist)) {
  console.error(`\n✗ sdk/dist is missing — the dashboard cannot start without the SDK build.\n  ${hint}\n`);
  process.exit(1);
}
const built = statSync(dist).mtimeMs;
const newest = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
    const p = join(dir, e.name);
    return Math.max(m, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }, 0);
const src = newest(join(root, "sdk/src"));
const bundle = readFileSync(dist, "utf8");
const missing = ["fetchDbc", "dbcFeeAt", "lockCollateral", "fetchQuotes"].filter((s) => !bundle.includes(s));
if (missing.length) {
  console.error(`\n✗ sdk/dist predates the app: ${missing.join(", ")} not exported.\n  ${hint}\n`);
  process.exit(1);
}
if (src > built) console.warn(`\n! sdk/src changed after sdk/dist was built — ${hint}\n`);
