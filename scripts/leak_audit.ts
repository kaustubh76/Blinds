/**
 * The attacker script (spec §15): scan a live cluster for any plaintext that should never be there.
 *
 * "The position never was" is a checkable property, so this checks it. For every wallet given (or
 * every member of the deployment), it walks the wallet's transaction history and every account
 * owned by the five programs, and searches the raw bytes for each secret quantity as a little-endian
 * u64 and as ASCII decimal.
 *
 * What is allowed to match, and why (the leak budget, docs/METHODOLOGY.md §6):
 *   - `Print` / `OracleState`: per-tick sums, matched volume and the marginal ratio are *published*
 *     after the print, each bound by a proof of correct decryption. A member alone at a tick is
 *     therefore revealed by that tick's aggregate — inherent to publishing a depth curve.
 *   - `Loan.fill_num` / `fill_den`: the disclosed marginal pro-rata ratio, identical for every loan
 *     at the marginal tick.
 * Anything else — a Bid, a Loan size, an Epoch, instruction data, a log line — is a leak and fails.
 *
 * Usage: pnpm leak-audit --cluster devnet [--secrets 1000000000,50000000000] [--limit 200]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Address, address, createSolanaRpc, getBase64Encoder } from "@solana/kit";
import { auction, credit, oracle, PROGRAMS } from "@thewindow/solana-sdk";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : fallback;
};

const cluster = arg("cluster", "localnet") as string;
const rpcUrl =
  process.env.WINDOW_RPC_URL ?? (cluster === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899");
const limit = Number(arg("limit", "200"));
const rpc = createSolanaRpc(rpcUrl);
const b64 = getBase64Encoder();

const KINDS: Array<[string, ArrayLike<number>]> = [
  ["Print", oracle.PRINT_DISCRIMINATOR],
  ["OracleState", oracle.ORACLE_STATE_DISCRIMINATOR],
  ["Bid", auction.BID_DISCRIMINATOR],
  ["Epoch", auction.EPOCH_DISCRIMINATOR],
  ["Config", auction.CONFIG_DISCRIMINATOR],
  ["Loan", credit.LOAN_DISCRIMINATOR],
  ["PriceCache", credit.PRICE_CACHE_DISCRIMINATOR],
];
const kindOf = (d: Uint8Array) =>
  KINDS.find(([, disc]) => Array.from(disc).every((b, i) => d[i] === b))?.[0] ?? "other";

/** `fill_num` and `fill_den` in `Loan`: 8 + 32 + 32 + 8 + 5×u8 = 85, then 93. */
const LOAN_FILL_OFFSETS = [85, 93];

const isDigit = (b: number | undefined) => b !== undefined && b >= 0x30 && b <= 0x39;

/**
 * Byte search. A decimal needle must stand alone: "987" inside a compute-unit count like "589874"
 * is arithmetic noise, while a real leak reads as its own number.
 */
function indexOf(hay: Uint8Array, needle: Uint8Array, decimal = false): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    if (decimal && (isDigit(hay[i - 1]) || isDigit(hay[i + needle.length]))) continue;
    return i;
  }
  return -1;
}

function needles(secrets: bigint[]) {
  return secrets.flatMap((v) => {
    const le = new Uint8Array(8);
    new DataView(le.buffer).setBigUint64(0, v, true);
    return [
      { name: `${v} (LE u64)`, bytes: le, decimal: false },
      { name: `${v} (ascii)`, bytes: new TextEncoder().encode(v.toString()), decimal: true },
    ];
  });
}

interface Hit {
  where: string;
  kind: string;
  secret: string;
  offset?: number;
  allowed: boolean;
}

async function main() {
  const deployment = JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../deployments/${cluster}.json`), "utf8"),
  ) as { agents: Array<{ wallet: string }> };
  const wallets: Address[] = (arg("wallets") ?? "")
    .split(",")
    .filter(Boolean)
    .map((w) => address(w))
    .concat(arg("wallets") ? [] : deployment.agents.map((a) => address(a.wallet)));

  // Default secrets: the agent bid sizes are 100..2,100 USDC in whole micro-USDC steps, so scan the
  // whole grid of round sizes an agent could have bid plus any explicitly given values.
  const explicit = (arg("secrets") ?? "")
    .split(",")
    .filter(Boolean)
    .map((s) => BigInt(s));
  const grid = explicit.length ? explicit : Array.from({ length: 21 }, (_, i) => BigInt(100 + i * 100) * 1_000_000n);
  const ns = needles(grid);
  const hits: Hit[] = [];

  console.log(`leak audit · ${cluster} · ${rpcUrl}`);
  console.log(`  ${wallets.length} wallets, ${grid.length} candidate secrets, ${ns.length} needles`);

  for (const w of wallets) {
    const sigs = await rpc.getSignaturesForAddress(w, { limit }).send();
    for (const s of sigs) {
      const tx = await rpc
        .getTransaction(s.signature, { encoding: "base64", maxSupportedTransactionVersion: 0 })
        .send();
      if (!tx) continue;
      const raw = new Uint8Array(b64.encode(tx.transaction[0]));
      const logs = new TextEncoder().encode((tx.meta?.logMessages ?? []).join("\n"));
      for (const n of ns) {
        if (indexOf(raw, n.bytes, n.decimal) >= 0)
          hits.push({ where: `tx ${s.signature}`, kind: "transaction", secret: n.name, allowed: false });
        if (indexOf(logs, n.bytes, n.decimal) >= 0)
          hits.push({ where: `logs ${s.signature}`, kind: "logs", secret: n.name, allowed: false });
      }
    }
    console.log(`  scanned ${sigs.length} transactions of ${w}`);
  }

  for (const [name, program] of Object.entries(PROGRAMS)) {
    const accounts = await rpc.getProgramAccounts(program, { encoding: "base64" }).send();
    for (const a of accounts) {
      const data = new Uint8Array(b64.encode(a.account.data[0]));
      const kind = kindOf(data);
      for (const n of ns) {
        const offset = indexOf(data, n.bytes, n.decimal);
        if (offset < 0) continue;
        const allowed =
          kind === "Print" || kind === "OracleState" || (kind === "Loan" && LOAN_FILL_OFFSETS.includes(offset));
        hits.push({ where: `account ${a.pubkey}`, kind, secret: n.name, offset, allowed });
      }
    }
    console.log(`  scanned ${accounts.length} accounts of ${name}`);
  }

  const leaks = hits.filter((h) => !h.allowed);
  const published = hits.length - leaks.length;
  console.log(
    `\n${hits.length} hit(s): ${published} in published aggregates (Print/OracleState/fill ratio), ${leaks.length} leak(s)`,
  );
  for (const l of leaks) console.log(`  LEAK  ${l.secret}  in ${l.kind} ${l.where} @${l.offset ?? "-"}`);
  if (leaks.length === 0) console.log("no plaintext size outside the leak budget — the position never was");
  process.exit(leaks.length === 0 ? 0 : 1);
}

await main();
