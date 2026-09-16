// Renders docs/measurements.json (written by the tier-1 measurement tests with
// WINDOW_WRITE_MEASUREMENTS=1) into the README's "Measurements" section.
import { readFileSync, writeFileSync } from "node:fs";

const m = JSON.parse(readFileSync("docs/measurements.json", "utf8"));
const n = (k) => (m[k] ?? 0).toLocaleString("en-US");
const rows = [
  [
    "`submit_bid` (validity inline + range context)",
    `${n("gate.submit_bid.validity_and_submit_bytes")} B / ${n("gate.submit_bid.verify_range_bytes")} B`,
    `${n("gate.submit_bid.validity_and_submit_cu")} + ${n("gate.submit_bid.verify_range_cu")}`,
  ],
  ["`attest_ticks`, 2 inline PoCDs (gate)", `${n("gate.attest_ticks_2.bytes")} B`, n("gate.attest_ticks_2.cu")],
  [
    "print, 1 nonzero tick",
    `${n("print_cost.nonzero_1.tx_count")} tx · ≤ ${n("print_cost.nonzero_1.max_attest_bytes")} B`,
    n("print_cost.nonzero_1.total_cu"),
  ],
  [
    "print, 10 nonzero ticks",
    `${n("print_cost.nonzero_10.tx_count")} tx · ≤ ${n("print_cost.nonzero_10.max_attest_bytes")} B`,
    n("print_cost.nonzero_10.total_cu"),
  ],
  [
    "print, 37 nonzero ticks",
    `${n("print_cost.nonzero_37.tx_count")} tx · ≤ ${n("print_cost.nonzero_37.max_attest_bytes")} B`,
    n("print_cost.nonzero_37.total_cu"),
  ],
  [
    "print, 74 nonzero ticks (worst case)",
    `${n("print_cost.nonzero_74.tx_count")} tx · ≤ ${n("print_cost.nonzero_74.max_attest_bytes")} B`,
    n("print_cost.nonzero_74.total_cu"),
  ],
];
const table = [
  "Measured on Agave 4.2 (LiteSVM 0.16) by `cargo test -p window-tests --test measurements`; `attest_batch = 4`.",
  'The programs are compiled `opt-level = "z"` because `programdata` rent is paid once and permanently at',
  "deploy (1,252,952 B \u21d2 6.37 SOL on devnet; `make size`): that trades 11\u201326 % more compute units for",
  "0.58 SOL and leaves transaction counts and sizes \u2014 the binding constraints \u2014 unchanged (amendment A12).",
  "",
  "| Path | Transactions / size | Compute units |",
  "|---|---|---|",
  ...rows.map((r) => `| ${r.join(" | ")} |`),
  "",
].join("\n");

const readme = readFileSync("README.md", "utf8");
const start = readme.indexOf("## Measurements");
const end = readme.indexOf("## ", start + 1);
if (start < 0 || end < 0) throw new Error("README: Measurements section not found");
const next = `${readme.slice(0, start)}## Measurements\n\n${table}\n${readme.slice(end)}`;
if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README measurements are stale; run `pnpm docs:measurements`");
    process.exit(1);
  }
} else writeFileSync("README.md", next);
