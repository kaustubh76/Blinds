/**
 * Watches the live market through the SDK: waits for `--epochs N` new prints (default 1), re-verifies
 * each from chain data and reports tx count + wall-clock per print. Exit 0 iff every print verifies.
 * Usage: WINDOW_RPC_URL=https://api.devnet.solana.com pnpm tsx scripts/watch_epoch.ts --epochs 1
 */
import { createSolanaRpc } from "@solana/kit";
import { fetchOracle, fetchPrint, formatRate, PrintStatus, verifyPrint } from "@thewindow/solana-sdk";

const flag = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const rpcUrl = process.env.WINDOW_RPC_URL ?? "http://127.0.0.1:8899";
const rpc = createSolanaRpc(rpcUrl);
const want = flag("epochs", 1);
// A devnet epoch lasts minutes and the public RPC rate-limits, so poll slowly there.
const pollMs = flag("poll-ms", rpcUrl.includes("devnet") ? 20_000 : 2_000);
const timeoutMs = flag("timeout-s", 3_600) * 1_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const start = await fetchOracle(rpc);
let seen = start?.hasPrinted ? start.lastPrintEpoch : -1n;
let ok = true;
console.log(`watching ${rpcUrl} from epoch ${seen} for ${want} print(s), polling every ${pollMs / 1000}s…`);
const t0 = Date.now();
for (let n = 0; n < want; ) {
  if (Date.now() - t0 > timeoutMs) {
    console.error(`timed out after ${(timeoutMs / 1000).toFixed(0)}s with ${n}/${want} print(s)`);
    process.exit(2);
  }
  await sleep(pollMs);
  const o = await fetchOracle(rpc);
  if (!o?.hasPrinted || o.lastPrintEpoch <= seen) continue;
  seen = o.lastPrintEpoch;
  n++;
  const p = await fetchPrint(rpc, seen);
  const v = await verifyPrint(rpc, seen);
  ok &&= v.ok;
  const rate = p?.status === PrintStatus.Printed ? formatRate(p.rStarTick) : "no trade";
  console.log(
    `epoch ${seen}: ${rate} · matched ${(Number(p?.matchedVolume ?? 0n) / 1e6).toLocaleString()} USDC · ${v.proven}/${v.nonzero} ticks proven in ${v.proofTransactions.length} attest tx · verify ${v.ok ? "OK" : `FAILED ${v.failures.join("; ")}`} · +${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
}
process.exit(ok ? 0 : 1);
