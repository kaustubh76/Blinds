/**
 * The lender agent's token launch (services/launch): the DBC pool's live state, read from whichever
 * cluster the launch record names. The record is bundled like the deployment descriptor; a mainnet
 * launch, when it exists, takes precedence over the devnet one.
 */
import { type Address, address, createSolanaRpc } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { fetchDbc, withRpcRetry } from "@thewindow/solana-sdk";
import devnetLaunch from "../../../deployments/launch-devnet.json";
import { config } from "../config";
import { rpc as deskRpc } from "./chain";
import { FEEDS, fetchFreshest, mainnetRpc } from "./pyth";

interface LaunchRecord {
  cluster: string;
  quote: { mint: string; decimals: number; usd: number };
  numbers: {
    initialUsd: number;
    migrationUsd: number;
    feeBps: { open: number; rest: number; durationSecs: number };
    raiseToAgentPct: number;
    creatorFeePct: number;
    supply: number;
  };
  token: { name: string; symbol: string };
  config: string;
  pool: string;
  baseMint: string;
  creator: string;
  txs: Record<string, string>;
  agent?: { id: string; walletAddress: string; name: string };
  graduated?: { tx: string; at: string };
}

const mainnetModules = import.meta.glob("../../../deployments/launch-mainnet.json", { eager: true, import: "default" });
const mainnetLaunch = Object.values(mainnetModules)[0] as LaunchRecord | undefined;

/** The launch the dashboard shows: mainnet when there is one, else the devnet rehearsal. */
export const LAUNCH: LaunchRecord = mainnetLaunch ?? (devnetLaunch as LaunchRecord);
export const launchCluster = LAUNCH.cluster === "mainnet" ? "mainnet-beta" : "devnet";

/** The pool lives on the launch's cluster, which need not be the desk's (a localnet dev server still shows the devnet rehearsal). */
const launchRpc =
  LAUNCH.cluster === "mainnet"
    ? mainnetRpc
    : config.cluster === "devnet"
      ? deskRpc
      : createSolanaRpc("https://api.devnet.solana.com");

export function useLaunch() {
  return useQuery({
    queryKey: ["launch", LAUNCH.pool],
    queryFn: async () => {
      const [dbc, wrapper, equity] = await Promise.all([
        withRpcRetry(() => fetchDbc(launchRpc, address(LAUNCH.pool))),
        fetchFreshest(mainnetRpc, FEEDS["Crypto.TSLAX/USD"]).catch(() => null),
        fetchFreshest(mainnetRpc, FEEDS["Equity.US.TSLA/USD"]).catch(() => null),
      ]);
      if (!dbc) return null;
      const dec = 10 ** LAUNCH.quote.decimals;
      // The same rule as services/launch: the wrapper feed while fresh, else the underlying equity —
      // the wrapper's only push account died on 12 Sep (docs/PYTH.md).
      const now = Math.floor(Date.now() / 1000);
      const fresh = wrapper && now - wrapper.publishTime <= 24 * 3600;
      const quote = fresh
        ? wrapper
        : equity && (!wrapper || equity.publishTime > wrapper.publishTime)
          ? equity
          : wrapper;
      const quoteFeed = quote === wrapper ? "Crypto.TSLAX/USD" : "Equity.US.TSLA/USD";
      const quoteUsd = quote ? Number(quote.price) * 10 ** quote.expo : LAUNCH.quote.usd;
      return {
        ...dbc,
        raisedQuote: Number(dbc.pool.quoteReserve) / dec,
        thresholdQuote: Number(dbc.config.migrationQuoteThreshold) / dec,
        creatorFeeQuote: Number(dbc.pool.creatorQuoteFee) / dec,
        partnerFeeQuote: Number(dbc.pool.partnerQuoteFee) / dec,
        totalFeeQuote: Number(dbc.pool.totalTradingQuoteFee) / dec,
        quoteUsd,
        quoteFromPyth: !!quote,
        quoteFeed: quote ? quoteFeed : null,
        quoteAgeSecs: quote ? Math.max(0, now - quote.publishTime) : null,
        pool: dbc.pool as typeof dbc.pool & { address: Address },
      };
    },
    refetchInterval: 30_000,
    retry: 1,
  });
}
