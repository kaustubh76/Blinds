/**
 * Pyth on the dashboard: the underlying equity feed read straight from Pyth's mainnet account, to
 * set beside the wrapper quote the desk marks collateral with. No API key — `PriceUpdateV2`
 * accounts are public. The public mainnet RPC answers 403 to browser origins, so the read goes
 * through a browser-friendly endpoint (`VITE_MAINNET_RPC_URL`, default PublicNode).
 */
import { type Address, createSolanaRpc } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import {
  decodePriceUpdate,
  hexToBytes,
  PYTH_PUSH_ORACLE,
  PYTH_RECEIVER,
  type PythPrice,
  pushOraclePda,
} from "@thewindow/solana-sdk";

export { decodePriceUpdate, hexToBytes, PYTH_PUSH_ORACLE, PYTH_RECEIVER, type PythPrice, pushOraclePda };

/** Pyth feed ids (hex, no 0x). The desk's own feed id comes from the deployment; these are the comparison feeds. */
export const FEEDS = {
  /** Regular Apple-style equity feed for Tesla: 09:30–16:00 ET, Mon–Fri. */
  "Equity.US.TSLA/USD": "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  /** The xStock wrapper the desk marks with: a 24/7 feed. */
  "Crypto.TSLAX/USD": "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
} as const;

export const MAINNET_RPC_URL: string = import.meta.env.VITE_MAINNET_RPC_URL ?? "https://solana-rpc.publicnode.com";
export const mainnetRpc = createSolanaRpc(MAINNET_RPC_URL);

/** The freshest of a feed's push-oracle accounts (shards 0 and 1), or null when none is readable. */
export async function fetchFreshest(
  rpc: typeof mainnetRpc,
  feedIdHex: string,
  shards: number[] = [0, 1],
): Promise<(PythPrice & { account: Address }) | null> {
  const pdas = await Promise.all(shards.map((s) => pushOraclePda(s, feedIdHex)));
  const res = await rpc.getMultipleAccounts(pdas, { encoding: "base64", commitment: "confirmed" }).send();
  let best: (PythPrice & { account: Address }) | null = null;
  res.value.forEach((acc, i) => {
    const account = pdas[i];
    if (!acc || !account || acc.owner !== PYTH_RECEIVER) return;
    try {
      const bytes = Uint8Array.from(atob(acc.data[0]), (c) => c.charCodeAt(0));
      const p = decodePriceUpdate(bytes, feedIdHex);
      if (!best || p.publishTime > best.publishTime) best = { ...p, account };
    } catch {
      // a shard holding another feed, or garbage: skip it
    }
  });
  return best;
}

/** `Equity.US.TSLA/USD` from Pyth's mainnet accounts; refreshed every minute. Never blocks the page. */
export const useUnderlying = (feedIdHex: string = FEEDS["Equity.US.TSLA/USD"]) =>
  useQuery({
    queryKey: ["pyth-underlying", feedIdHex, MAINNET_RPC_URL],
    queryFn: () => fetchFreshest(mainnetRpc, feedIdHex),
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });

const usd = (price: bigint, expo: number): number => Number(price) * 10 ** expo;

/** Wrapper premium (+) or discount (−) to the underlying, in basis points. */
export function basisBps(
  wrapper: { price: bigint; expo: number },
  underlying: { price: bigint; expo: number },
): number {
  const u = usd(underlying.price, underlying.expo);
  if (u <= 0) return 0;
  return ((usd(wrapper.price, wrapper.expo) - u) / u) * 10_000;
}

export const formatBasis = (bps: number): string => `${bps >= 0 ? "+" : "−"}${Math.abs(bps).toFixed(1)} bp`;

/**
 * NYSE regular session: 09:30–16:00 America/New_York, Monday–Friday. Holidays are not modelled —
 * the label says "regular hours", not "trading". The equity feed's own `publish_time` is the truth.
 */
export function nyseSession(at: Date = new Date()): { open: boolean; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const weekdayOk = !["Sat", "Sun"].includes(weekday);
  const open = weekdayOk && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  return { open, label: open ? "regular hours · 09:30–16:00 ET" : "outside regular hours" };
}
