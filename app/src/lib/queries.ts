/** TanStack Query hooks over the SDK's read lens. Keys are stable; refetch intervals follow the slot clock. */
import type { Address } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAuctionConfig,
  fetchBidsFor,
  fetchConfidentialAccount,
  fetchCreditConfig,
  fetchEpoch,
  fetchLoansFor,
  fetchMember,
  fetchMultiplier,
  fetchOracle,
  fetchPrint,
  fetchQuote,
  fetchQuotes,
  fetchSeries,
  fetchTokenAmount,
  pda,
  type QuoteSource,
  withRpcRetry,
} from "@thewindow/solana-sdk";
import { config } from "../config";
import { fetchDeployment, rpc } from "./chain";
import { mainnetRpc } from "./pyth";

// Public devnet RPC rate-limits browsers hard, and a devnet epoch lasts minutes, so poll slowly
// there; a localnet epoch is seconds and the validator is ours.
const SLOT_MS = config.cluster === "devnet" ? 10_000 : 2_000;

export const useDeployment = () =>
  useQuery({ queryKey: ["deployment"], queryFn: fetchDeployment, staleTime: Number.POSITIVE_INFINITY });

export const useSlot = () =>
  useQuery({
    queryKey: ["slot"],
    queryFn: async () => Number(await rpc.getSlot({ commitment: "confirmed" }).send()),
    refetchInterval: SLOT_MS,
  });

export const useAuctionConfig = () =>
  useQuery({ queryKey: ["auctionConfig"], queryFn: () => fetchAuctionConfig(rpc), refetchInterval: SLOT_MS });

export const useCreditConfig = () =>
  useQuery({ queryKey: ["creditConfig"], queryFn: () => fetchCreditConfig(rpc), staleTime: 60_000 });

export const useOracle = () =>
  useQuery({ queryKey: ["oracle"], queryFn: () => fetchOracle(rpc), refetchInterval: SLOT_MS });

export const useEpoch = (index: bigint | null) =>
  useQuery({
    queryKey: ["epoch", index?.toString()],
    queryFn: () => (index === null ? null : fetchEpoch(rpc, index)),
    enabled: index !== null,
    refetchInterval: SLOT_MS,
  });

export const usePrint = (index: bigint | null) =>
  useQuery({
    queryKey: ["print", index?.toString()],
    queryFn: () => (index === null ? null : fetchPrint(rpc, index)),
    enabled: index !== null,
    refetchInterval: SLOT_MS * 2,
  });

export const useSeries = (latest: bigint | null, limit = 60) =>
  useQuery({
    queryKey: ["series", latest?.toString(), limit],
    queryFn: () => (latest === null ? [] : fetchSeries(rpc, latest, limit)),
    enabled: latest !== null,
    refetchInterval: SLOT_MS * 3,
  });

/** One listing's quote, read the way the program reads it (cache PDA, or its Pyth account for source 4). */
export const useQuote = (listing: QuoteSource | undefined) =>
  useQuery({
    queryKey: ["price", listing ? `${listing.priceSource}:${Array.from(listing.feedId).join(",")}` : ""],
    queryFn: () => (listing ? fetchQuote(rpc, listing) : null),
    enabled: !!listing,
    refetchInterval: SLOT_MS * 2,
  });

/** A Token-2022 mint as the cluster holds it: what a browser can check about a token we only mirror. */
export interface MintFacts {
  program: string;
  decimals: number;
  /** Raw supply, and the same figure in whole tokens. */
  supply: number;
  /** Token-2022 extensions, in the order the RPC lists them (`transferFeeConfig`, `confidentialTransferMint`, …). */
  extensions: string[];
}

/** Parse a `jsonParsed` mint account; `null` for anything that is not an initialised mint. */
export function mintFacts(value: unknown): MintFacts | null {
  const v = value as
    | {
        owner?: string;
        data?: { parsed?: { type?: string; info?: Record<string, unknown> } };
      }
    | null
    | undefined;
  const info = v?.data?.parsed?.info;
  if (!v?.owner || !info || v.data?.parsed?.type !== "mint") return null;
  const decimals = Number(info.decimals);
  const supply = Number(info.supply);
  if (!Number.isFinite(decimals) || !Number.isFinite(supply)) return null;
  const extensions = Array.isArray(info.extensions)
    ? (info.extensions as Array<{ extension?: string }>).map((e) => String(e.extension)).filter(Boolean)
    : [];
  return { program: v.owner, decimals, supply: supply / 10 ** decimals, extensions };
}

/**
 * A mint on **mainnet**, read straight from this browser — the real token behind a devnet twin.
 * Never blocks a card: `null` when the public RPC does not answer.
 */
export const useMainnetMint = (address: string | undefined) =>
  useQuery<MintFacts | null>({
    queryKey: ["mainnet-mint", address ?? ""],
    queryFn: async () => {
      if (!address) return null;
      try {
        const res = await mainnetRpc
          .getAccountInfo(address as Address, { encoding: "jsonParsed", commitment: "confirmed" })
          .send();
        return mintFacts(res.value);
      } catch {
        return null;
      }
    },
    enabled: !!address,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

/** What the keeper last read from an attested mark's API: the mark it posted and the implied price it did not. */
export interface MarkSnapshot {
  key: string;
  symbol: string;
  source: string;
  feed_id_hex: string;
  url: string;
  mark_e8: number;
  implied_e8: number | null;
  basis_bps: number | null;
  /** The company behind the token, as the API publishes it: valuations in whole USD, supply ×1e8. */
  mark_valuation_usd?: number;
  implied_valuation_usd?: number;
  supply_e8?: number;
  fetched_at: number;
}

/**
 * `GET <admin>/marks` — the implied price beside the mark (the PreStocks basis). Only while the admin
 * service is reachable (the market runs); `null` without an admin URL or when it does not answer.
 */
export const useMarks = () => {
  // The admin URL in force: the `?admin=` link, or the hosted pointer file discovered by fetchDeployment.
  const dep = useDeployment();
  const base = dep.data?.adminUrl ?? config.adminUrl ?? "";
  return useQuery<Record<string, MarkSnapshot> | null>({
    queryKey: ["marks", base],
    queryFn: async () => {
      if (!base) return null;
      try {
        const res = await fetch(`${base}/marks`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return null;
        return (await res.json()) as Record<string, MarkSnapshot>;
      } catch {
        return null;
      }
    },
    enabled: dep.isFetched,
    refetchInterval: 60_000,
    retry: 0,
  });
};

/** What `GET <admin>/faucet` answers: the demo faucet's remaining budget this hour. */
export interface FaucetStatus {
  remaining_this_hour: number;
  max_per_hour: number;
  min_balance_sol: number;
}

/**
 * `GET <admin>/faucet` — how much of the demo faucet's hourly budget is left. The Desk says so
 * before a Join rather than letting a rate limit arrive as an unexplained failure. `null` without an
 * admin URL, or from a service older than the route.
 */
export const useFaucet = () => {
  const dep = useDeployment();
  const base = dep.data?.adminUrl ?? config.adminUrl ?? "";
  return useQuery<FaucetStatus | null>({
    queryKey: ["faucet", base],
    queryFn: async () => {
      if (!base) return null;
      try {
        const res = await fetch(`${base}/faucet`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return null;
        return (await res.json()) as FaucetStatus;
      } catch {
        return null;
      }
    },
    enabled: dep.isFetched,
    refetchInterval: 60_000,
    retry: 0,
  });
};

/** All listings' price caches in one call (the public RPC rate-limits a query per row); retried through 429s. */
/** Every listing's quote, read the way the program reads it (cache PDA, or the Pyth account for source 4), in one RPC call. */
export const usePrices = (listings: QuoteSource[] | undefined) =>
  useQuery({
    queryKey: [
      "quotes",
      (listings ?? []).map((l) => `${l.priceSource}:${Array.from(l.feedId.slice(0, 4)).join(".")}`).join("|"),
    ],
    queryFn: () => withRpcRetry(() => fetchQuotes(rpc, listings ?? []), { attempts: 4 }),
    enabled: !!listings && listings.length > 0,
    refetchInterval: SLOT_MS * 2,
  });

export const useMultiplier = (mint: Address | undefined) =>
  useQuery({
    queryKey: ["multiplier", mint],
    queryFn: () => (mint ? fetchMultiplier(rpc, mint) : null),
    enabled: !!mint,
    refetchInterval: 30_000,
  });

export const useMember = (owner: Address | undefined) =>
  useQuery({
    queryKey: ["member", owner],
    queryFn: () => (owner ? fetchMember(rpc, owner) : null),
    enabled: !!owner,
    refetchInterval: SLOT_MS * 2,
  });

export const useLoans = (wallet: Address | undefined) =>
  useQuery({
    queryKey: ["loans", wallet],
    queryFn: () => (wallet ? fetchLoansFor(rpc, wallet) : { borrowed: [], lent: [] }),
    enabled: !!wallet,
    refetchInterval: SLOT_MS * 2,
  });

export const useBids = (wallet: Address | undefined) =>
  useQuery({
    queryKey: ["bids", wallet],
    queryFn: () => (wallet ? fetchBidsFor(rpc, wallet) : []),
    enabled: !!wallet,
    refetchInterval: SLOT_MS * 2,
  });

export const useSolBalance = (wallet: Address | undefined) =>
  useQuery({
    queryKey: ["sol", wallet],
    queryFn: async () => (wallet ? BigInt((await rpc.getBalance(wallet).send()).value) : 0n),
    enabled: !!wallet,
    refetchInterval: SLOT_MS * 2,
  });

/** The member's two token accounts (ATAs) and the confidential extension view of the cSTOCK-W one. */
export const useTokenAccounts = (wallet: Address | undefined, mockMint?: Address, cstockMint?: Address) =>
  useQuery({
    queryKey: ["tokenAccounts", wallet, mockMint, cstockMint],
    queryFn: async () => {
      if (!wallet || !mockMint || !cstockMint) return null;
      const [mockAta, cstockAta] = await Promise.all([pda.ata(wallet, mockMint), pda.ata(wallet, cstockMint)]);
      const [mock, cstock] = await Promise.all([
        fetchTokenAmount(rpc, mockAta),
        fetchConfidentialAccount(rpc, cstockAta),
      ]);
      return { mockAta, cstockAta, mockAmount: mock, cstock };
    },
    enabled: !!wallet && !!mockMint && !!cstockMint,
    refetchInterval: SLOT_MS * 2,
  });
