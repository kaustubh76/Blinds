/**
 * Watches the live market through the SDK: waits for `--epochs N` new prints (default 1), re-verifies
 * each from chain data and reports tx count + wall-clock per print. Exit 0 iff every print verifies.
 * Usage: WINDOW_RPC_URL=https://api.devnet.solana.com pnpm tsx scripts/watch_epoch.ts --epochs 1
 */
import { createSolanaRpc } from "@solana/kit";
import { fetchOracle, fetchPrint, formatRate, PrintStatus, verifyPrint } from "@thewindow/solana-sdk";

const rpc = createSolanaRpc(process.env.WINDOW_RPC_URL ?? "http://127.0.0.1:8899");
const want = Number(process.argv[process.argv.indexOf("--epochs") + 1] || 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const start = await fetchOracle(rpc);
let seen = start?.hasPrinted ? start.lastPrintEpoch : -1n;
let ok = true;
console.log(`watching from epoch ${seen} for ${want} print(s)…`);
const t0 = Date.now();
for (let n = 0; n < want; ) {
  await sleep(2_000);
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
