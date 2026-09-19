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
