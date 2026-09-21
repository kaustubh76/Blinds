/**
 * `window-launch`: the lender agent's token launch on Meteora's Dynamic Bonding Curve, quoted in a
 * tokenized stock, configured from the desk's numbers (see plan.ts), plus its Clawpump identity.
 *
 *   pnpm --filter @thewindow/launch plan      # read TSLAx/USD from Pyth, write deployments/launch-plan.json
 *   pnpm --filter @thewindow/launch launch    # create config + pool (+ metadata) — WINDOW_LAUNCH_KEYPAIR pays
 *   pnpm --filter @thewindow/launch status    # progress to graduation, price in quote and USD, fees
 *   pnpm --filter @thewindow/launch buy 5     # buy with 5 quote tokens (moves the curve; devnet test balance)
 *   pnpm --filter @thewindow/launch graduate  # migrate to DAMM v2 once the threshold is met
 *   pnpm --filter @thewindow/launch agent     # the Clawpump agent (CLAWPUMP_API_KEY): reuse + rename, or create → wallet
 *   pnpm --filter @thewindow/launch clawpump-launch   # the agent's identity coin on pump.fun, paired with TSLAx (agent pays)
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
import {
  type ClawpumpAgent,
  type ClawpumpError,
  clawpump,
  describe402,
  LENDER_PERSONA,
  launchBody,
  pickAgent,
  TSLAX_MINT,
} from "./clawpump.js";
import { buildPlan, DEFAULTS, type LaunchPlan } from "./plan.js";
import { fetchQuoteUsd } from "./pyth.js";

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
  quote: {
    mint: string;
    decimals: number;
    usd: number;
    feed?: string;
    pythAccount: string;
    publishTime: number;
    ageSecs: number;
  };
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
  clawpump?: {
    agentId: string;
    symbol: string;
    mint: string;
    txHash: string;
    pumpUrl: string;
    explorerUrl?: string;
    quoteMint: string;
    launchedAt: string;
    requestId?: string;
  };
  graduated?: { tx: string; at: string };
}

/** The recorded agent (from `agent`), wherever it was written: the launch file first, else the plan file. */
const recordedAgent = () =>
  readJson<LaunchFile>(LAUNCH_FILE)?.agent ?? readJson<PlanFile & { agent?: LaunchFile["agent"] }>(PLAN_FILE)?.agent;
const LAMPORTS = 1_000_000_000;
/** Pool creation cost 0.0266 SOL on devnet (tx 5aadUBpt…); this leaves room for fees and a retry. */
const LAUNCH_MIN_SOL = 0.04;

async function quoteForCluster(conn: Connection, payer: Keypair | null) {
  const mainnet = new Connection(MAINNET_RPC, "confirmed");
  const q = await fetchQuoteUsd(mainnet);
  if (!q) throw new Error("no Pyth TSLAX/USD or TSLA/USD account readable on mainnet");
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
      feed: q.feed,
      pythAccount: q.account,
      publishTime: q.publishTime,
      ageSecs: q.ageSecs,
    },
    numbers: p.summary,
    token: TOKEN,
  };
  const kept = readJson<PlanFile & { agent?: LaunchFile["agent"] }>(PLAN_FILE)?.agent;
  writeJson(PLAN_FILE, kept ? { ...file, agent: kept } : file);
  log("plan written", {
    file: PLAN_FILE,
    quoteUsd: q.usd,
    pricedFrom: q.feed,
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
  if (CLUSTER === "mainnet" && file.quote.ageSecs > 3 * 24 * 3600) {
    throw new Error(
      `the Pyth ${file.quote.feed} quote is ${file.quote.ageSecs} s old — refuse to price a mainnet launch on it`,
    );
  }
  const balance = (await conn.getBalance(payer.publicKey)) / LAMPORTS;
  if (balance < LAUNCH_MIN_SOL) {
    throw new Error(
      `the launch key ${payer.publicKey.toBase58()} holds ${balance} SOL on ${CLUSTER}; the pool needs ~${LAUNCH_MIN_SOL} — send ${(LAUNCH_MIN_SOL - balance).toFixed(3)} SOL and run again (nothing was sent)`,
    );
  }
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const config = Keypair.generate();
  const baseMint = Keypair.generate();
  const quoteMint = new PublicKey(file.quote.mint);
  // The creator is the agent: fees and the migration fee go to its wallet. LAUNCH_CREATOR overrides;
  // the recorded Clawpump wallet is the default; the payer only when there is neither.
  const agent = recordedAgent();
  const creator = process.env.LAUNCH_CREATOR
    ? new PublicKey(process.env.LAUNCH_CREATOR)
    : agent
      ? new PublicKey(agent.walletAddress)
      : payer.publicKey;
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
    feeClaimer: creator,
    leftoverReceiver: creator,
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
  const existing = readJson<LaunchFile>(LAUNCH_FILE);
  const out: LaunchFile = {
    ...file,
    config: config.publicKey.toBase58(),
    pool: pool.toBase58(),
    baseMint: baseMint.publicKey.toBase58(),
    payer: payer.publicKey.toBase58(),
    creator: creator.toBase58(),
    feeClaimer: creator.toBase58(),
    txs: { createConfigAndPool: sig },
    ...(agent ? { agent } : {}),
    ...(existing?.clawpump ? { clawpump: existing.clawpump } : {}),
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
  const q = await fetchQuoteUsd(new Connection(MAINNET_RPC, "confirmed"));
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
    quotePricedFrom: q?.feed ?? null,
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
  // The agent: its wallet's SOL (it pays its own Clawpump launch) and the identity coin, when there is one.
  const a = l.agent;
  const agentSol = a ? (await conn.getBalance(new PublicKey(a.walletAddress))) / LAMPORTS : null;
  console.log(
    JSON.stringify(
      {
        ...out,
        feeClaimer: l.feeClaimer,
        agent: a ? { ...a, sol: agentSol, isCreator: l.creator === a.walletAddress } : null,
        clawpump: l.clawpump ?? null,
      },
      null,
      2,
    ),
  );
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

/** The Clawpump key, or a clear refusal. Never printed. */
function clawpumpKey(): string {
  const key = process.env.CLAWPUMP_API_KEY;
  if (!key) throw new Error("CLAWPUMP_API_KEY is not set (clawpump.tech/developers → API keys)");
  return key;
}

/**
 * The lender's Clawpump identity: the account's one agent is reused and renamed (an explicit
 * CLAWPUMP_AGENT_ID wins; `--new` creates another). Its wallet becomes the pool's creator and fee wallet.
 */
async function agent(forceNew: boolean) {
  const key = clawpumpKey();
  const name = process.env.CLAWPUMP_AGENT_NAME ?? "The Window Lender";
  const fields = { name, persona: LENDER_PERSONA, skills: ["solana"] };
  const list = await clawpump<{ agents: ClawpumpAgent[] }>(key, "GET", "/agents");
  const pick = pickAgent(list.data.agents ?? [], process.env.CLAWPUMP_AGENT_ID, forceNew);
  let a: ClawpumpAgent;
  if (pick.action === "update") {
    const r = await clawpump<ClawpumpAgent | { agent: ClawpumpAgent }>(key, "POST", `/agents/${pick.agent.id}`, fields);
    const got = "agent" in r.data ? r.data.agent : r.data;
    a = { ...pick.agent, ...got, name: got?.name ?? name };
    log("Clawpump agent updated", { id: a.id, from: pick.agent.name, to: a.name, requestId: r.requestId });
  } else {
    const r = await clawpump<ClawpumpAgent | { agent: ClawpumpAgent }>(key, "POST", "/agents", fields);
    a = "agent" in r.data ? r.data.agent : r.data;
    log("Clawpump agent created", { id: a.id, requestId: r.requestId });
  }
  if (!a.walletAddress) throw new Error("Clawpump returned an agent without a walletAddress");
  const record = { id: a.id, walletAddress: a.walletAddress, name: a.name };
  const l = readJson<LaunchFile>(LAUNCH_FILE);
  if (l) writeJson(LAUNCH_FILE, { ...l, agent: record });
  else writeJson(PLAN_FILE, { ...(readJson<PlanFile>(PLAN_FILE) ?? { cluster: CLUSTER }), agent: record });
  log("the lender agent", { ...record, recordedIn: l ? LAUNCH_FILE : PLAN_FILE });
}

/**
 * The agent's identity coin, launched by Clawpump on pump.fun and paired with TSLAx; the agent's own
 * wallet pays (`selfFunded`), so it must hold the launch cost (0.0092 SOL for a custom pair, 21 Sep).
 */
async function clawpumpLaunch(again: boolean) {
  const key = clawpumpKey();
  const a = recordedAgent();
  if (!a) throw new Error("no Clawpump agent recorded — run `agent` first");
  const l = readJson<LaunchFile>(LAUNCH_FILE);
  if (l?.clawpump?.mint && !again)
    throw new Error(
      `already launched: ${l.clawpump.symbol} ${l.clawpump.mint} (${l.clawpump.pumpUrl}); pass --again to launch another`,
    );
  const body = launchBody({
    agentId: a.id,
    name: process.env.CLAWPUMP_TOKEN_NAME ?? "The Window Lender",
    symbol: process.env.CLAWPUMP_TOKEN_SYMBOL ?? "LENDER",
    description:
      process.env.CLAWPUMP_TOKEN_DESCRIPTION ??
      "The identity coin of THE WINDOW's lender agent: an autonomous lender on a private margin desk for tokenized stocks on Solana, earning the xONIA overnight rate on loans proven solvent in zero knowledge. Paired with TSLAx. Its capital token WLEND runs on a Meteora DBC pool. Not investment advice.",
    imageUrl: process.env.CLAWPUMP_TOKEN_IMAGE_URL ?? "https://kaustubh76.github.io/Blinds/launch/lender.png",
    quoteMint: process.env.CLAWPUMP_QUOTE_MINT ?? TSLAX_MINT,
    creatorFeeBps: Number(process.env.CLAWPUMP_CREATOR_FEE_BPS ?? 100),
    website: "https://kaustubh76.github.io/Blinds/#/market",
  });
  log("launching the identity coin through Clawpump", {
    agent: a.id,
    wallet: a.walletAddress,
    symbol: body.symbol,
    quote: body.pumpQuoteMint,
  });
  let r: Awaited<ReturnType<typeof clawpump<Record<string, unknown>>>>;
  try {
    r = await clawpump<Record<string, unknown>>(key, "POST", "/launch", body);
  } catch (e) {
    const err = e as ClawpumpError;
    if (err.status === 402)
      throw new Error(
        `Clawpump 402 (request ${err.requestId ?? "?"}): ${describe402(err.body)} — the agent wallet ${a.walletAddress} pays; fund it and run again`,
      );
    throw e;
  }
  const d = r.data;
  const mint = String(d.mintAddress ?? d.mint ?? "");
  if (!mint) throw new Error(`Clawpump answered without a mint: ${JSON.stringify(d).slice(0, 400)}`);
  const rec: NonNullable<LaunchFile["clawpump"]> = {
    agentId: a.id,
    symbol: body.symbol,
    mint,
    txHash: String(d.txHash ?? ""),
    pumpUrl: String(d.pumpUrl ?? `https://pump.fun/coin/${mint}`),
    ...(d.explorerUrl ? { explorerUrl: String(d.explorerUrl) } : {}),
    quoteMint: body.pumpQuoteMint,
    launchedAt: new Date().toISOString(),
    ...(r.requestId ? { requestId: r.requestId } : {}),
  };
  if (l) writeJson(LAUNCH_FILE, { ...l, agent: l.agent ?? a, clawpump: rec });
  else {
    const p = readJson<PlanFile>(PLAN_FILE);
    writeJson(PLAN_FILE, { ...(p ?? {}), agent: a, clawpump: rec });
  }
  log("identity coin launched", { ...rec, status: d.status ?? null });
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
  else if (cmd === "agent") await agent(process.argv.includes("--new"));
  else if (cmd === "clawpump-launch") await clawpumpLaunch(process.argv.includes("--again"));
  else {
    console.error("usage: main.ts plan|launch|status|buy <quote>|graduate|agent [--new]|clawpump-launch [--again]");
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
