/**
 * `window-launch`: the lender agent's token launch on Meteora's Dynamic Bonding Curve, quoted in a
 * tokenized stock, configured from the desk's numbers (see plan.ts), plus its Clawpump identity.
 *
 *   pnpm --filter @thewindow/launch plan      # read TSLAx/USD from Pyth, write deployments/launch-plan.json
 *   pnpm --filter @thewindow/launch launch    # create config + pool (+ metadata) — WINDOW_LAUNCH_KEYPAIR pays
 *   pnpm --filter @thewindow/launch status    # progress to graduation, price in quote and USD, fees
 *   pnpm --filter @thewindow/launch buy 5     # buy with 5 quote tokens (moves the curve; devnet test balance)
 *   pnpm --filter @thewindow/launch buy -- --to-graduation   # keep buying until the curve is complete
 *   pnpm --filter @thewindow/launch graduate  # migrate to DAMM v2 once the threshold is met
 *   pnpm --filter @thewindow/launch agent     # the Clawpump agent: reuse + rename, persona, avatar, start
 *   pnpm --filter @thewindow/launch agent-status      # what Clawpump reports about it now (read-only)
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
  deriveDammV2MigrationMetadataAddress,
  deriveDammV2PoolAddress,
  deriveDbcEventAuthority,
  deriveDbcPoolAddress,
  deriveTokenBadgeAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  type Transaction,
  TransactionInstruction,
  Transaction as Web3Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  agentFields,
  type ClawpumpAgent,
  type ClawpumpError,
  clawpump,
  describe402,
  launchBody,
  newAgentFields,
  pickAgent,
  TSLAX_MINT,
} from "./clawpump.js";
import { buildPlan, DEFAULTS, dammConfigFor, type LaunchPlan } from "./plan.js";
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
  /** The key that would pay for the launch (`WINDOW_LAUNCH_KEYPAIR`), when this machine holds one. */
  payer?: string;
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
  agent?: {
    id: string;
    walletAddress: string;
    name: string;
    /** As Clawpump reports it after the call: `running` is what its dashboard counts as deployed. */
    status?: string;
    /** Whether the persona and avatar actually took (read back, never assumed). */
    persona?: boolean;
    avatarUrl?: string | null;
    checkedAt?: string;
  };
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
  graduated?: {
    tx: string;
    at: string;
    /** The DAMM v2 pool the liquidity moved into, and the config the migration named. */
    dammPool?: string;
    dammConfig?: string;
    metadata?: string;
    metadataTx?: string;
  };
  /** An earlier rehearsal on this cluster that ran the whole way (this record's pool is the live one). */
  previousGraduation?: { pool: string; dammPool?: string; tx: string; at: string };
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
    ...(payer ? { payer: payer.publicKey.toBase58() } : {}),
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
    // A pool that already graduated is not lost when a fresh one is launched beside it: the record
    // keeps the finished rehearsal so the dashboard can show both.
    ...(existing?.graduated
      ? {
          previousGraduation: {
            pool: existing.pool,
            ...(existing.graduated.dammPool ? { dammPool: existing.graduated.dammPool } : {}),
            tx: existing.graduated.tx,
            at: existing.graduated.at,
          },
        }
      : existing?.previousGraduation
        ? { previousGraduation: existing.previousGraduation }
        : {}),
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

/** `migration_damm_v2_create_metadata` — the account `migration_damm_v2` reads; the SDK builds no helper for it. */
const CREATE_METADATA_DISCRIMINATOR = Buffer.from([109, 189, 19, 36, 195, 183, 222, 82]);
const DBC_PROGRAM = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

function createMigrationMetadataIx(pool: PublicKey, config: PublicKey, payer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: DBC_PROGRAM,
    data: CREATE_METADATA_DISCRIMINATOR,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: deriveDammV2MigrationMetadataAddress(pool), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: deriveDbcEventAuthority(), isSigner: false, isWritable: false },
      { pubkey: DBC_PROGRAM, isSigner: false, isWritable: false },
    ],
  });
}

/**
 * Graduation: the curve is complete, so the liquidity moves to DAMM v2 and both LP positions are
 * locked for good. Two instructions, in order — the metadata account the migration reads, then the
 * migration itself against the DAMM v2 config that matches this pool's `migrationFeeOption`.
 */
async function graduate(conn: Connection, payer: Keypair) {
  const l = readJson<LaunchFile>(LAUNCH_FILE);
  if (!l) throw new Error("no launch yet");
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const pool = new PublicKey(l.pool);
  const vp = await client.state.getPool(pool);
  if (!vp) throw new Error("pool account missing");
  if (vp.poolState.isMigrated) {
    log("already graduated", { pool: l.pool, dammPool: l.graduated?.dammPool ?? null });
    return;
  }
  const progress = await client.state.getPoolQuoteTokenCurveProgress(pool);
  if (progress < 1) throw new Error(`the curve is ${(progress * 100).toFixed(1)} % of the way to graduation`);
  const cfgKey = vp.poolState.config;
  const cfg = await client.state.getPoolConfig(cfgKey);
  if (!cfg) throw new Error("pool config account missing");
  const dammConfig = new PublicKey(dammConfigFor(cfg.migrationFeeOption, process.env.LAUNCH_DAMM_CONFIG));
  const metadata = deriveDammV2MigrationMetadataAddress(pool);
  let metadataTx: string | undefined;
  if (!(await conn.getAccountInfo(metadata))) {
    const tx = new Web3Transaction().add(createMigrationMetadataIx(pool, cfgKey, payer.publicKey));
    metadataTx = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
    log("migration metadata created", { metadata: metadata.toBase58(), tx: metadataTx });
  }
  const r = await client.migration.migrateToDammV2({ payer: payer.publicKey, pool, dammConfig });
  const sig = await sendAndConfirmTransaction(
    conn,
    r.transaction,
    [payer, r.firstPositionNftKeypair, r.secondPositionNftKeypair],
    { commitment: "confirmed" },
  );
  const dammPool = deriveDammV2PoolAddress(dammConfig, vp.poolState.baseMint, cfg.quoteMint);
  writeJson(LAUNCH_FILE, {
    ...l,
    graduated: {
      tx: sig,
      at: new Date().toISOString(),
      dammPool: dammPool.toBase58(),
      dammConfig: dammConfig.toBase58(),
      metadata: metadata.toBase58(),
      ...(metadataTx ? { metadataTx } : {}),
    },
  });
  log("graduated to DAMM v2", {
    tx: sig,
    dammPool: dammPool.toBase58(),
    dammConfig: dammConfig.toBase58(),
    migrationFeeOption: cfg.migrationFeeOption,
  });
}

/** One swap: `amount` quote tokens into the curve. Returns the signature. */
async function swap(conn: Connection, payer: Keypair, l: LaunchFile, amount: number): Promise<string> {
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const tx = await client.pool.swap({
    owner: payer.publicKey,
    pool: new PublicKey(l.pool),
    amountIn: new BN(Math.round(amount * 10 ** l.quote.decimals)),
    minimumAmountOut: new BN(0),
    swapBaseForQuote: false,
    referralTokenAccount: null,
  });
  return sendAndConfirmTransaction(conn, tx as Transaction, [payer], { commitment: "confirmed" });
}

/**
 * Buy the agent's token with quote tokens — the trade that moves the curve. `--to-graduation` keeps
 * buying what is left of the migration threshold until the curve is complete: fees are taken from the
 * quote, so the reserve grows by less than the amount in and one swap never quite finishes it.
 */
async function buy(conn: Connection, payer: Keypair, amount: number, toGraduation: boolean) {
  const l = readJson<LaunchFile>(LAUNCH_FILE);
  if (!l) throw new Error("no launch yet");
  const client = DynamicBondingCurveClient.create(conn, "confirmed");
  const pool = new PublicKey(l.pool);
  if (!toGraduation) {
    if (!(amount > 0)) throw new Error("usage: buy <quote amount> | buy --to-graduation");
    const sig = await swap(conn, payer, l, amount);
    log("bought", { quoteIn: amount, tx: sig });
    return;
  }
  const dec = 10 ** l.quote.decimals;
  const threshold = Number((await client.state.getPoolMigrationQuoteThreshold(pool)).toString()) / dec;
  const chunk = amount > 0 ? amount : 50;
  const txs: string[] = [];
  for (let round = 0; round < 24; round++) {
    const vp = await client.state.getPool(pool);
    if (!vp) throw new Error("pool account missing");
    const reserve = Number(vp.poolState.quoteReserve.toString()) / dec;
    const progress = await client.state.getPoolQuoteTokenCurveProgress(pool);
    if (progress >= 1 || reserve >= threshold) {
      log("curve complete", { progress, raised: reserve, threshold, txs });
      return;
    }
    // What is still missing, never more: the curve holds only the base tokens the threshold buys, and
    // an amount past that is refused outright (`InsufficientLiquidity`). The fee comes out of the input,
    // so the reserve grows by a little less than the ask and the next round closes the rest.
    // Down to one base unit of the quote: the fee rides on the input, so the reserve lands a few
    // units short of the threshold and the program calls the curve complete only at `>=`.
    // Three units, not one: the fee rounds up, so a smaller ask leaves the reserve where it was.
    const unit = 3 / dec;
    let want = Math.min(chunk, Math.max(unit, threshold - reserve));
    let sig: string | null = null;
    for (let attempt = 0; attempt < 8 && sig === null; attempt++) {
      try {
        sig = await swap(conn, payer, l, want);
      } catch (e) {
        const text = `${String(e)} ${JSON.stringify((e as { logs?: string[] }).logs ?? [])}`;
        if (!text.includes("InsufficientLiquidity") || attempt === 7) throw e;
        // The curve's last base tokens cost less quote than the gap, because the fee rides on top.
        want *= 0.9;
      }
    }
    if (sig) txs.push(sig);
    log("bought", { quoteIn: Number(want.toFixed(6)), raisedBefore: reserve, threshold, tx: sig });
  }
  throw new Error(`still short of the threshold after 12 rounds (txs: ${txs.join(", ")})`);
}

/** The Clawpump key, or a clear refusal. Never printed. */
function clawpumpKey(): string {
  const key = process.env.CLAWPUMP_API_KEY;
  if (!key) throw new Error("CLAWPUMP_API_KEY is not set (clawpump.tech/developers → API keys)");
  return key;
}

/**
 * The lender's Clawpump identity: the account's one agent is reused and renamed (an explicit
 * CLAWPUMP_AGENT_ID wins; `--new` creates another), given the lender's persona, avatar and skills,
 * and **started** — Clawpump counts only a running agent as deployed. Whatever the API then reports
 * is what gets recorded: a write is never assumed to have taken.
 */
async function agent(forceNew: boolean, start: boolean) {
  const key = clawpumpKey();
  const name = process.env.CLAWPUMP_AGENT_NAME ?? "The Window Lender";
  const avatar = process.env.CLAWPUMP_TOKEN_IMAGE_URL ?? "https://kaustubh76.github.io/Blinds/launch/lender.png";
  const list = await clawpump<{ agents: ClawpumpAgent[] }>(key, "GET", "/agents");
  const pick = pickAgent(list.data.agents ?? [], process.env.CLAWPUMP_AGENT_ID, forceNew);
  const unwrap = (d: ClawpumpAgent | { agent: ClawpumpAgent }) => ("agent" in d ? d.agent : d);
  let id: string;
  if (pick.action === "update") {
    const r = await clawpump<ClawpumpAgent | { agent: ClawpumpAgent }>(
      key,
      "POST",
      `/agents/${pick.agent.id}`,
      agentFields(name, avatar),
    );
    id = unwrap(r.data)?.id ?? pick.agent.id;
    log("Clawpump agent updated", { id, from: pick.agent.name, to: name, requestId: r.requestId });
  } else {
    const r = await clawpump<ClawpumpAgent | { agent: ClawpumpAgent }>(
      key,
      "POST",
      "/agents",
      newAgentFields(name, avatar),
    );
    id = unwrap(r.data).id;
    log("Clawpump agent created", { id, requestId: r.requestId });
  }
  if (start) {
    try {
      const r = await clawpump<unknown>(key, "POST", `/agents/${id}/start`);
      log("Clawpump agent started", { id, requestId: r.requestId });
    } catch (e) {
      const err = e as ClawpumpError;
      // A start that needs credits is no reason to lose the identity just written.
      console.error(`start refused (${err.status ?? "?"}): ${err.message.slice(0, 200)}`);
    }
  }
  // Read it back: the API drops what it does not recognise, so only what it returns is true.
  const back = unwrap((await clawpump<ClawpumpAgent | { agent: ClawpumpAgent }>(key, "GET", `/agents/${id}`)).data);
  if (!back.walletAddress) throw new Error("Clawpump returned an agent without a walletAddress");
  const record = {
    id: back.id,
    walletAddress: back.walletAddress,
    name: back.name,
    status: back.status ?? "unknown",
    persona: !!back.persona,
    avatarUrl: back.avatarUrl ?? null,
    checkedAt: new Date().toISOString(),
  };
  const l = readJson<LaunchFile>(LAUNCH_FILE);
  if (l) writeJson(LAUNCH_FILE, { ...l, agent: record });
  else writeJson(PLAN_FILE, { ...(readJson<PlanFile>(PLAN_FILE) ?? { cluster: CLUSTER }), agent: record });
  log("the lender agent", { ...record, skills: back.skills?.length ?? 0, recordedIn: l ? LAUNCH_FILE : PLAN_FILE });
  if (record.status !== "running")
    console.error(`note: Clawpump reports status "${record.status}" — its dashboard counts only running agents`);
  if (!record.persona && pick.action === "update")
    console.error(
      "note: this agent has no persona — Clawpump's update endpoint refuses `persona`; only a newly created agent (`--new`) can carry one",
    );
}

/** Read-only: what Clawpump says about the recorded agent right now. */
async function agentStatus() {
  const key = clawpumpKey();
  const a = recordedAgent();
  if (!a) throw new Error("no Clawpump agent recorded — run `agent` first");
  const r = await clawpump<ClawpumpAgent | { agent: ClawpumpAgent }>(key, "GET", `/agents/${a.id}`);
  const back = "agent" in r.data ? r.data.agent : r.data;
  console.log(
    JSON.stringify(
      {
        id: back.id,
        name: back.name,
        status: back.status,
        walletAddress: back.walletAddress,
        persona: !!back.persona,
        avatarUrl: back.avatarUrl ?? null,
        skills: back.skills ?? [],
        recorded: a,
      },
      null,
      2,
    ),
  );
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
let payer = needsPayer ? keypair("WINDOW_LAUNCH_KEYPAIR", `${process.env.HOME}/.config/solana/id.json`) : null;
// A plan spends nothing, but it should record which key would pay — the dashboard's journey names it.
if (!payer && cmd === "plan") {
  try {
    payer = keypair("WINDOW_LAUNCH_KEYPAIR", `${process.env.HOME}/.config/solana/id.json`);
  } catch {
    // no keypair on this machine: the plan is still worth writing
  }
}
try {
  if (cmd === "plan") await plan(conn, payer);
  else if (cmd === "launch") await launch(conn, payer as Keypair);
  else if (cmd === "status") await status(conn);
  else if (cmd === "graduate") await graduate(conn, payer as Keypair);
  else if (cmd === "buy")
    await buy(conn, payer as Keypair, Number(process.argv[3]) || 0, process.argv.includes("--to-graduation"));
  else if (cmd === "agent") await agent(process.argv.includes("--new"), !process.argv.includes("--no-start"));
  else if (cmd === "agent-status") await agentStatus();
  else if (cmd === "clawpump-launch") await clawpumpLaunch(process.argv.includes("--again"));
  else {
    console.error(
      "usage: main.ts plan|launch|status|buy <quote>|buy --to-graduation|graduate|agent [--new] [--no-start]|agent-status|clawpump-launch [--again]",
    );
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
