/**
 * `window-launch`: the lender agent's token launch on Meteora's Dynamic Bonding Curve, quoted in a
 * tokenized stock, configured from the desk's numbers (see plan.ts), plus its Clawpump identity.
 *
 *   pnpm --filter @thewindow/launch plan      # read TSLAx/USD from Pyth, write deployments/launch-plan.json
 *   pnpm --filter @thewindow/launch launch    # create config + pool (+ metadata) — WINDOW_LAUNCH_KEYPAIR pays
 *   pnpm --filter @thewindow/launch status    # progress to graduation, price in quote and USD, fees
 *   pnpm --filter @thewindow/launch buy 5     # buy with 5 quote tokens (moves the curve; devnet test balance)
 *   pnpm --filter @thewindow/launch graduate  # migrate to DAMM v2 once the threshold is met
 *   pnpm --filter @thewindow/launch agent     # create the Clawpump agent (CLAWPUMP_API_KEY) → wallet
 *
 * Cluster: LAUNCH_CLUSTER=mainnet|devnet (default devnet). On devnet the quote is a plain SPL mint this
 * tool creates (xStocks exist on mainnet only); on mainnet it is TSLAx, a Meteora-badged quote.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
  deriveTokenBadgeAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { buildPlan, DEFAULTS, type LaunchPlan } from "./plan.js";
import { fetchFreshest, TSLAX_USD_FEED } from "./pyth.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
try {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m?.[1] && m[2] !== undefined && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env: the environment must carry the settings
}

const CLUSTER = (process.env.LAUNCH_CLUSTER ?? "devnet") as "devnet" | "mainnet";
const RPC =
  process.env.LAUNCH_RPC_URL ??
  (CLUSTER === "mainnet"
    ? (process.env.WINDOW_PRICE_RPC_URL ?? "https://api.mainnet-beta.solana.com")
    : "https://api.devnet.solana.com");
const MAINNET_RPC = process.env.WINDOW_PRICE_RPC_URL ?? "https://api.mainnet-beta.solana.com";
/** TSLAx (xStocks, Backed) on mainnet: Token-2022, 8 decimals, Meteora-badged as a DBC quote. */
const TSLAX_MAINNET = new PublicKey("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB");
const PLAN_FILE = resolve(ROOT, "deployments", `launch-plan-${CLUSTER}.json`);
const LAUNCH_FILE = resolve(ROOT, "deployments", `launch-${CLUSTER}.json`);
const TOKEN = {
  name: process.env.LAUNCH_TOKEN_NAME ?? "The Window Lender",
  symbol: process.env.LAUNCH_TOKEN_SYMBOL ?? "WLEND",
  uri: process.env.LAUNCH_TOKEN_URI ?? "https://kaustubh76.github.io/Blinds/launch/wlend.json",
};

function keypair(env: string, dflt?: string): Keypair {
  const path = process.env[env] ?? dflt;
  if (!path) throw new Error(`${env} is not set`);
  const raw = JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME ?? ""), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);
const writeJson = (p: string, v: unknown) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }));

interface PlanFile {
  cluster: string;
  createdAt: string;
  quote: { mint: string; decimals: number; usd: number; pythAccount: string; publishTime: number; ageSecs: number };
  numbers: ReturnType<typeof buildPlan>["summary"];
  token: typeof TOKEN;
}
interface LaunchFile extends PlanFile {
  config: string;
  pool: string;
  baseMint: string;
  payer: string;
  creator: string;
  feeClaimer: string;
  txs: Record<string, string>;
  agent?: { id: string; walletAddress: string; name: string };
  graduated?: { tx: string; at: string };
}

async function quoteForCluster(conn: Connection, payer: Keypair | null) {
  const mainnet = new Connection(MAINNET_RPC, "confirmed");
  const q = await fetchFreshest(mainnet, TSLAX_USD_FEED);
  if (!q) throw new Error("no Pyth TSLAX/USD account readable on mainnet");
  if (CLUSTER === "mainnet") return { mint: TSLAX_MAINNET, decimals: 8 as const, q };
  // devnet: a plain SPL twin of the quote, 8 decimals like TSLAx; the tool mints itself a test balance
  const existing = readJson<PlanFile>(PLAN_FILE);
  if (existing?.quote.mint && !process.env.LAUNCH_NEW_QUOTE)
    return { mint: new PublicKey(existing.quote.mint), decimals: 8 as const, q };
  if (!payer) throw new Error("a payer is needed to create the devnet quote mint");
  const mint = await createMint(conn, payer, payer.publicKey, null, 8);
  const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  await mintTo(conn, payer, mint, ata.address, payer, 1_000n * 100_000_000n);
  log("devnet quote mint created (a TSLAx twin, 8 dp, 1,000 minted to the payer)", { mint: mint.toBase58() });
  return { mint, decimals: 8 as const, q };
}

async function plan(conn: Connection, payer: Keypair | null): Promise<{ file: PlanFile; plan: LaunchPlan }> {
  const { mint, decimals, q } = await quoteForCluster(conn, payer);
  const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
  const p = buildPlan({
    ...DEFAULTS,
    initialUsd: num("LAUNCH_INITIAL_USD", DEFAULTS.initialUsd),
    migrationUsd: num("LAUNCH_MIGRATION_USD", DEFAULTS.migrationUsd),
    raiseToAgentPct: num("LAUNCH_RAISE_TO_AGENT_PCT", DEFAULTS.raiseToAgentPct),
    quoteUsd: q.usd,
    quoteDecimals: decimals,
  });
  const file: PlanFile = {
    cluster: CLUSTER,
    createdAt: new Date().toISOString(),
    quote: {
      mint: mint.toBase58(),
      decimals,
      usd: q.usd,
      pythAccount: q.account,
      publishTime: q.publishTime,
      ageSecs: q.ageSecs,
    },
    numbers: p.summary,
    token: TOKEN,
  };
  writeJson(PLAN_FILE, file);
  log("plan written", {
    file: PLAN_FILE,
    quoteUsd: q.usd,
    pythAgeSecs: q.ageSecs,
    initialMarketCapQuote: p.summary.initialMarketCapQuote.toFixed(4),
    migrationMarketCapQuote: p.summary.migrationMarketCapQuote.toFixed(4),
    migrationQuoteThreshold: `${(Number(p.config.migrationQuoteThreshold.toString()) / 10 ** decimals).toFixed(4)} quote`,
    curvePoints: p.config.curve.length,
  });
  return { file, plan: p };
}

async function launch(conn: Connection, payer: Keypair) {
  const { file, plan: p } = await plan(conn, payer);
  if (CLUSTER === "mainnet" && file.quote.ageSecs > 7 * 24 * 3600) {
    throw new Error(`the Pyth quote is ${file.quote.ageSecs} s old — refuse to price a mainnet launch on it`);
  }
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const config = Keypair.generate();
  const baseMint = Keypair.generate();
  const quoteMint = new PublicKey(file.quote.mint);
  const creator = process.env.LAUNCH_CREATOR ? new PublicKey(process.env.LAUNCH_CREATOR) : payer.publicKey;
  const badge = deriveTokenBadgeAddress(quoteMint);
  const badgeInfo = await conn.getAccountInfo(badge);
  log("creating config + pool", {
    config: config.publicKey.toBase58(),
    baseMint: baseMint.publicKey.toBase58(),
    quoteMint: quoteMint.toBase58(),
    creator: creator.toBase58(),
    tokenBadge: badgeInfo ? badge.toBase58() : "none (permissionless quote)",
  });
  const tx = await client.partner.createConfigAndPool({
    payer: payer.publicKey,
    config: config.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    quoteMint,
    ...(badgeInfo ? { tokenBadge: badge } : {}),
    ...p.config,
    // With a migration fee, the SDK's derived pre/post supply fails the program's supply check
    // (InvalidTokenSupply, seen on devnet); leaving the supply to the program is what the docs allow.
    ...(p.config.migrationFee.feePercentage > 0 ? { tokenSupply: null } : {}),
    preCreatePoolParam: {
      name: TOKEN.name,
      symbol: TOKEN.symbol,
      uri: TOKEN.uri,
      poolCreator: creator,
      baseMint: baseMint.publicKey,
    },
  });
  const sig = await sendAndConfirmTransaction(conn, tx as Transaction, [payer, config, baseMint], {
    commitment: "confirmed",
  });
  const pool = deriveDbcPoolAddress(quoteMint, baseMint.publicKey, config.publicKey);
  const existingAgent = readJson<LaunchFile>(LAUNCH_FILE)?.agent;
  const out: LaunchFile = {
    ...file,
    config: config.publicKey.toBase58(),
    pool: pool.toBase58(),
    baseMint: baseMint.publicKey.toBase58(),
    payer: payer.publicKey.toBase58(),
    creator: creator.toBase58(),
    feeClaimer: payer.publicKey.toBase58(),
    txs: { createConfigAndPool: sig },
    ...(existingAgent ? { agent: existingAgent } : {}),
  };
  writeJson(LAUNCH_FILE, out);
  log("launched", { pool: out.pool, tx: sig, file: LAUNCH_FILE });
}

async function status(conn: Connection) {
  const l = readJson<LaunchFile>(LAUNCH_FILE);
  if (!l) throw new Error(`no launch on ${CLUSTER} yet (${LAUNCH_FILE})`);
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const pool = new PublicKey(l.pool);
  const [vp, progress, fees, threshold] = await Promise.all([
    client.state.getPool(pool),
    client.state.getPoolQuoteTokenCurveProgress(pool),
    client.state.getPoolFeeMetrics(pool),
    client.state.getPoolMigrationQuoteThreshold(pool),
  ]);
  if (!vp) throw new Error("pool account missing");
  const q = await fetchFreshest(new Connection(MAINNET_RPC, "confirmed"), TSLAX_USD_FEED);
  const quoteUsd = q?.usd ?? l.quote.usd;
  const dec = 10 ** l.quote.decimals;
  const st = vp.poolState;
  const raisedQuote = Number(st.quoteReserve.toString()) / dec;
  const out = {
    cluster: CLUSTER,
    pool: l.pool,
    baseMint: l.baseMint,
    quoteMint: l.quote.mint,
    progress,
    raisedQuote,
    raisedUsd: raisedQuote * quoteUsd,
    thresholdQuote: Number(threshold.toString()) / dec,
    thresholdUsd: (Number(threshold.toString()) / dec) * quoteUsd,
    quoteUsd,
    pythAgeSecs: q?.ageSecs ?? null,
    isMigrated: st.isMigrated,
    migrationProgress: st.migrationProgress,
    creatorQuoteFee: Number(fees.current.creatorQuoteFee.toString()) / dec,
    partnerQuoteFee: Number(fees.current.partnerQuoteFee.toString()) / dec,
    totalTradingQuoteFee: Number(fees.total.totalTradingQuoteFee.toString()) / dec,
    creator: l.creator,
    agent: l.agent ?? null,
    at: new Date().toISOString(),
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function graduate(conn: Connection, payer: Keypair) {
  const l = readJson<LaunchFile>(LAUNCH_FILE);
  if (!l) throw new Error("no launch yet");
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const pool = new PublicKey(l.pool);
  const progress = await client.state.getPoolQuoteTokenCurveProgress(pool);
  if (progress < 1) throw new Error(`the curve is ${(progress * 100).toFixed(1)} % of the way to graduation`);
  const dammConfig = new PublicKey(process.env.LAUNCH_DAMM_CONFIG ?? "7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd");
  const r = await client.migration.migrateToDammV2({ payer: payer.publicKey, pool, dammConfig });
  const sig = await sendAndConfirmTransaction(
    conn,
    r.transaction,
    [payer, r.firstPositionNftKeypair, r.secondPositionNftKeypair],
    {
      commitment: "confirmed",
    },
  );
  writeJson(LAUNCH_FILE, { ...l, graduated: { tx: sig, at: new Date().toISOString() } });
  log("graduated to DAMM v2", { tx: sig });
}

/** Buy the agent's token with `amount` quote tokens (whole units) — the trade that moves the curve. */
async function buy(conn: Connection, payer: Keypair, amount: number) {
  const l = readJson<LaunchFile>(LAUNCH_FILE);
  if (!l) throw new Error("no launch yet");
  if (!(amount > 0)) throw new Error("usage: buy <quote amount>");
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const pool = new PublicKey(l.pool);
  const amountIn = new BN(Math.round(amount * 10 ** l.quote.decimals));
  const tx = await client.pool.swap({
    owner: payer.publicKey,
    pool,
    amountIn,
    minimumAmountOut: new BN(0),
    swapBaseForQuote: false,
    referralTokenAccount: null,
  });
  const sig = await sendAndConfirmTransaction(conn, tx as Transaction, [payer], { commitment: "confirmed" });
  log("bought", { quoteIn: amount, tx: sig });
}

/** A Clawpump agent: the lender's identity and revenue wallet. Bearer `cpk_…` key from clawpump.tech/developers. */
async function agent() {
  const key = process.env.CLAWPUMP_API_KEY;
  if (!key) throw new Error("CLAWPUMP_API_KEY is not set (clawpump.tech/developers → API keys)");
  const base = process.env.CLAWPUMP_API_URL ?? "https://clawpump.tech/api/v1";
  const name = process.env.CLAWPUMP_AGENT_NAME ?? "The Window Lender";
  const body = {
    name,
    persona:
      "An autonomous lender on THE WINDOW for Stocks, a private margin desk for tokenized stocks on Solana: it lends USDC every overnight window against tokenized-stock collateral proven solvent in zero knowledge, and earns the xONIA overnight rate. Its token trades on a TSLAx-quoted Meteora DBC pool.",
    skills: ["solana"],
  };
  const res = await fetch(`${base}/agents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Clawpump ${res.status}: ${text.slice(0, 300)}`);
  const a = JSON.parse(text) as { id: string; walletAddress: string };
  const l = readJson<LaunchFile>(LAUNCH_FILE) ?? readJson<PlanFile>(PLAN_FILE);
  const record = { id: a.id, walletAddress: a.walletAddress, name };
  writeJson(LAUNCH_FILE, { ...(l ?? {}), agent: record });
  log("Clawpump agent created", record);
}

const cmd = process.argv[2];
const conn = new Connection(RPC, "confirmed");
const needsPayer = cmd === "launch" || cmd === "graduate" || cmd === "buy" || (cmd === "plan" && CLUSTER === "devnet");
const payer = needsPayer ? keypair("WINDOW_LAUNCH_KEYPAIR", `${process.env.HOME}/.config/solana/id.json`) : null;
try {
  if (cmd === "plan") await plan(conn, payer);
  else if (cmd === "launch") await launch(conn, payer as Keypair);
  else if (cmd === "status") await status(conn);
  else if (cmd === "graduate") await graduate(conn, payer as Keypair);
  else if (cmd === "buy") await buy(conn, payer as Keypair, Number(process.argv[3]));
  else if (cmd === "agent") await agent();
  else {
    console.error("usage: main.ts plan|launch|status|buy <quote>|graduate|agent");
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
