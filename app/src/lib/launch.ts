/**
 * The lender agent's token launch (services/launch): the DBC pool's live state, read from whichever
 * cluster the launch record names. The record is bundled like the deployment descriptor; a mainnet
 * launch, when it exists, takes precedence over the devnet one.
 */
import { address, createSolanaRpc } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { type DbcConfig, type DbcPool, dbcPrice, fetchDbc, withRpcRetry } from "@thewindow/solana-sdk";
import devnetLaunch from "../../../deployments/launch-devnet.json";
import { config } from "../config";
import { rpc as deskRpc } from "./chain";
import { FEEDS, fetchFreshest, mainnetRpc } from "./pyth";
import { mintFacts } from "./queries";

/** `deployments/launch-<cluster>.json`, as `services/launch` writes it. */
export interface LaunchRecord {
  cluster: "devnet" | "mainnet";
  createdAt: string;
  quote: {
    mint: string;
    decimals: number;
    /** The quote stock's USD price the plan was built on. */
    usd: number;
    /** Which Pyth feed priced it (absent on records written before 21 Sep). */
    feed?: string;
    pythAccount: string;
    publishTime: number;
    ageSecs: number;
  };
  numbers: {
    quoteUsd: number;
    initialMarketCapQuote: number;
    migrationMarketCapQuote: number;
    /** What the curve raises before it graduates, in quote units. */
    migrationQuoteThreshold?: number;
    initialUsd: number;
    migrationUsd: number;
    feeBps: { open: number; rest: number; periods: number; durationSecs: number };
    raiseToAgentPct: number;
    creatorFeePct: number;
    supply: number;
  };
  token: { name: string; symbol: string; uri: string };
  config: string;
  pool: string;
  baseMint: string;
  payer: string;
  creator: string;
  feeClaimer: string;
  txs: Record<string, string>;
  /** The Clawpump identity (`services/launch agent`), as Clawpump reported it when last checked. */
  agent?: {
    id: string;
    walletAddress: string;
    name: string;
    /** `running` is what Clawpump's dashboard counts as deployed. */
    status?: string;
    /** Whether a persona is set — the partner API refuses to add one to an existing agent. */
    persona?: boolean;
    avatarUrl?: string | null;
    /** The coin Clawpump's own record ties to this agent — their confirmation of our mint. */
    tokenAddress?: string | null;
    checkedAt?: string;
  };
  /** The identity coin Clawpump launched for the agent (`services/launch clawpump-launch`). */
  clawpump?: {
    agentId: string;
    symbol: string;
    mint: string;
    txHash: string;
    pumpUrl: string;
    explorerUrl?: string;
    quoteMint: string;
    launchedAt: string;
  };
  graduated?: {
    tx: string;
    at: string;
    dammPool?: string;
    dammConfig?: string;
    metadata?: string;
    metadataTx?: string;
  };
  /** An earlier pool on this cluster that ran the whole way; this record's pool is the live one. */
  previousGraduation?: { pool: string; dammPool?: string; tx: string; at: string };
}

const mainnetModules = import.meta.glob("../../../deployments/launch-mainnet.json", { eager: true, import: "default" });
const mainnetLaunch = Object.values(mainnetModules)[0] as LaunchRecord | undefined;
// The mainnet *plan* carries the Clawpump identity before the mainnet pool exists (`services/launch agent`).
const planModules = import.meta.glob("../../../deployments/launch-plan-mainnet.json", {
  eager: true,
  import: "default",
});
const mainnetPlan = Object.values(planModules)[0] as Partial<LaunchRecord> | undefined;

/** The mainnet plan (`services/launch plan`), when one has been written: it names the payer and the agent. */
export const MAINNET_PLAN: Partial<LaunchRecord> | null = mainnetPlan ?? null;

/** The agent's identity, wherever it was recorded: the mainnet launch, the mainnet plan, else the devnet record. */
export const AGENT: LaunchRecord["agent"] | undefined =
  mainnetLaunch?.agent ?? mainnetPlan?.agent ?? (devnetLaunch as LaunchRecord).agent;
const withAgent = (r: LaunchRecord): LaunchRecord => (r.agent || !AGENT ? r : { ...r, agent: AGENT });

/** Both records, for the journey: the devnet rehearsal always exists; mainnet once the launch has run. */
export const DEVNET_LAUNCH: LaunchRecord = withAgent(devnetLaunch as LaunchRecord);
export const MAINNET_LAUNCH: LaunchRecord | null = mainnetLaunch ? withAgent(mainnetLaunch) : null;
/** The launch the dashboard shows: mainnet when there is one, else the devnet rehearsal. */
export const LAUNCH: LaunchRecord = MAINNET_LAUNCH ?? DEVNET_LAUNCH;
export const launchCluster = LAUNCH.cluster === "mainnet" ? "mainnet-beta" : "devnet";
/**
 * What the base token's decimals are *meant* to be (`services/launch/src/plan.ts` mints with 6). Used
 * only when the mint itself will not read: the chain's own field is the one that scales a price.
 */
export const LAUNCH_BASE_DECIMALS = 6;
/** Where the token trades once it is on mainnet; nothing on devnet (a twin quote mint no venue lists). */
export const tradeUrl =
  LAUNCH.cluster === "mainnet" ? `https://jup.ag/swap/${LAUNCH.quote.mint}-${LAUNCH.baseMint}` : null;

/** The pool lives on the launch's cluster, which need not be the desk's (a localnet dev server still shows the devnet rehearsal). */
const launchRpc =
  LAUNCH.cluster === "mainnet"
    ? mainnetRpc
    : config.cluster === "devnet"
      ? deskRpc
      : createSolanaRpc("https://api.devnet.solana.com");

export type QuoteFeed = "Crypto.TSLAX/USD" | "Equity.US.TSLA/USD";
/** Older than this and the wrapper's quote is a dead account, not a price (`services/launch/src/pyth.ts`). */
export const QUOTE_MAX_AGE_SECS = 24 * 3600;

/**
 * Which Pyth read prices the quote stock — the same rule as `services/launch`: the wrapper feed while it
 * is fresh, else the fresher of the two (the wrapper's only push account died on 12 Sep, docs/PYTH.md).
 */
export function chooseQuote<Q extends { publishTime: number }>(
  wrapper: Q | null,
  equity: Q | null,
  nowSecs: number,
): (Q & { feed: QuoteFeed; ageSecs: number; fresh: boolean }) | null {
  // `fresh` is the age rule applied to whatever was chosen, because the last branch returns a quote the
  // first branch already judged too old: with both feeds past the limit the caller has to know that the
  // number it is about to display is stale rather than infer it from `ageSecs`.
  const age = (q: Q) => Math.max(0, nowSecs - q.publishTime);
  const out = (q: Q, feed: QuoteFeed) => ({ ...q, feed, ageSecs: age(q), fresh: age(q) <= QUOTE_MAX_AGE_SECS });
  if (wrapper && age(wrapper) <= QUOTE_MAX_AGE_SECS) return out(wrapper, "Crypto.TSLAX/USD");
  if (equity && (!wrapper || equity.publishTime > wrapper.publishTime)) return out(equity, "Equity.US.TSLA/USD");
  return wrapper ? out(wrapper, "Crypto.TSLAX/USD") : null;
}

export interface LaunchState {
  pool: DbcPool;
  config: DbcConfig;
  /** quoteReserve / migrationQuoteThreshold, capped at 1. */
  progress: number;
  raisedQuote: number;
  thresholdQuote: number;
  /** The creator's share. Zero on a pool configured the way this one is — see `claimableFeeQuote`. */
  creatorFeeQuote: number;
  partnerFeeQuote: number;
  /**
   * What the fee claimer can actually take: the partner stream, plus the creator's only if the
   * creator and the claimer are the same wallet. This is the number the agent earns.
   */
  claimableFeeQuote: number;
  totalFeeQuote: number;
  /** Spot, in quote per base token. */
  spotQuote: number;
  /** USD per quote token, from Pyth when readable, else the launch-time price. */
  quoteUsd: number;
  quoteFeed: QuoteFeed | null;
  quoteAgeSecs: number | null;
  /** The base token's whole supply, and the decimals both sides were scaled by. */
  supply: number;
  quoteDecimals: number;
  baseDecimals: number;
  /** True when the decimals and the supply came from the mints rather than the launch record. */
  scaledFromChain: boolean;
  /** True when `quoteUsd` came from a Pyth read inside its age limit, false when it is the record's. */
  quoteLive: boolean;
  /**
   * Whether everything this pool earns reaches the agent.
   *
   * Not "is the agent the creator": Meteora makes the creator a *signer*, and the agent's wallet is
   * Clawpump's, so the creator can only ever be the key that signed the launch. What decides where the
   * money goes is the fee claimer, plus the creator keeping no share of it.
   */
  feesToAgent: boolean | null;
}

/** Numbers the pool gives us, or `null` when they cannot be trusted (a malformed record, a zero threshold). */
export function deriveLaunchState(
  dbc: { pool: DbcPool; config: DbcConfig; progress: number },
  quote: { price: bigint; expo: number; feed: QuoteFeed; ageSecs: number; fresh: boolean } | null,
  record: Pick<LaunchRecord, "quote" | "agent" | "creator" | "numbers">,
  /**
   * The two mints as the chain holds them. Everything quote-denominated is scaled by a power of ten,
   * so taking that power from a bundled record made a wrong record a silent power-of-ten error on a
   * mainnet card; `services/launch` preflights the same field before it launches.
   */
  mints?: { quote: { decimals: number; supply: number } | null; base: { decimals: number; supply: number } | null },
): LaunchState | null {
  const quoteDecimals = mints?.quote?.decimals ?? record.quote.decimals;
  const baseDecimals = mints?.base?.decimals ?? LAUNCH_BASE_DECIMALS;
  const supply = mints?.base?.supply ?? record.numbers.supply;
  const dec = 10 ** quoteDecimals;
  const quoteUsd = quote ? Number(quote.price) * 10 ** quote.expo : record.quote.usd;
  const out: LaunchState = {
    pool: dbc.pool,
    config: dbc.config,
    progress: dbc.progress,
    raisedQuote: Number(dbc.pool.quoteReserve) / dec,
    thresholdQuote: Number(dbc.config.migrationQuoteThreshold) / dec,
    creatorFeeQuote: Number(dbc.pool.creatorQuoteFee) / dec,
    partnerFeeQuote: Number(dbc.pool.partnerQuoteFee) / dec,
    claimableFeeQuote:
      (Number(dbc.pool.partnerQuoteFee) +
        (dbc.pool.creator === dbc.config.feeClaimer ? Number(dbc.pool.creatorQuoteFee) : 0)) /
      dec,
    totalFeeQuote: Number(dbc.pool.totalTradingQuoteFee) / dec,
    spotQuote: dbcPrice(dbc.pool.sqrtPrice, baseDecimals, quoteDecimals),
    quoteUsd,
    quoteFeed: quote?.feed ?? null,
    quoteAgeSecs: quote?.ageSecs ?? null,
    quoteLive: quote?.fresh === true,
    supply,
    quoteDecimals,
    baseDecimals,
    scaledFromChain: !!mints?.quote && !!mints?.base,
    feesToAgent: record.agent
      ? dbc.config.feeClaimer === record.agent.walletAddress && dbc.config.creatorTradingFeePercentage === 0
      : null,
  };
  const finite = [
    out.progress,
    out.raisedQuote,
    out.thresholdQuote,
    out.creatorFeeQuote,
    out.claimableFeeQuote,
    out.spotQuote,
    out.quoteUsd,
  ];
  if (!finite.every(Number.isFinite) || out.thresholdQuote <= 0 || out.quoteUsd <= 0) return null;
  return out;
}

/** A mint's own decimals and supply, read on the launch's cluster. `null` when it does not answer. */
async function readMint(mint: string): Promise<{ decimals: number; supply: number } | null> {
  try {
    const res = await launchRpc
      .getAccountInfo(address(mint), { encoding: "jsonParsed", commitment: "confirmed" })
      .send();
    const f = mintFacts(res.value);
    return f ? { decimals: f.decimals, supply: f.supply } : null;
  } catch {
    return null;
  }
}

export type LaunchQuery =
  | { kind: "ok"; state: LaunchState }
  /** Which account was not there, so the screen names the right one rather than guessing the pool. */
  | { kind: "missing"; why: "no-pool" | "not-dbc" | "no-config"; account: string; owner?: string }
  | { kind: "malformed" };

export function useLaunch() {
  return useQuery<LaunchQuery>({
    queryKey: ["launch", LAUNCH.pool],
    queryFn: async () => {
      // Three attempts, not the SDK's six: an RPC that is down should show as such within seconds.
      const [dbc, wrapper, equity, quoteMint, baseMint] = await Promise.all([
        withRpcRetry(() => fetchDbc(launchRpc, address(LAUNCH.pool)), { attempts: 3, label: "dbc" }),
        fetchFreshest(mainnetRpc, FEEDS["Crypto.TSLAX/USD"]).catch(() => null),
        fetchFreshest(mainnetRpc, FEEDS["Equity.US.TSLA/USD"]).catch(() => null),
        readMint(LAUNCH.quote.mint),
        readMint(LAUNCH.baseMint),
      ]);
      if (!dbc.ok)
        return { kind: "missing", why: dbc.why, account: dbc.account, ...(dbc.owner ? { owner: dbc.owner } : {}) };
      const quote = chooseQuote(wrapper, equity, Math.floor(Date.now() / 1000));
      const state = deriveLaunchState(dbc, quote, LAUNCH, { quote: quoteMint, base: baseMint });
      return state ? { kind: "ok", state } : { kind: "malformed" };
    },
    refetchInterval: 30_000,
    retry: 1,
  });
}
