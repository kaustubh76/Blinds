import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { PriceSource } from "@thewindow/solana-sdk";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingView } from "./chain";

const listing = (key: string, cstockMint: string): ListingView => ({
  key,
  symbol: `${key}-mock`,
  source: "mock",
  listing: `${key}Listing11111111111111111111111111111` as never,
  mockMint: `${key}Mock111111111111111111111111111111111` as never,
  cstockMint: cstockMint as never,
  escrow: `${key}Escrow1111111111111111111111111111111` as never,
  feedId: new Uint8Array(32),
  decimals: 3,
  haircutBps: 15000n,
  maxPriceAgeSlots: 1200,
  maxPublishAgeSecs: 3600,
  priceSource: 3,
  priceAccount: null,
  provider: null,
  sourceMint: null,
  sourceSymbol: null,
});
const LISTINGS = [listing("tsla", "MintA"), listing("openai", "MintB")];

/** The chain's quotes for LISTINGS, in order; a test sets which of them are fresh. */
const now = Math.floor(Date.now() / 1000);
const quote = (ageSecs: number) => ({ price: 1n, expo: -8, publishTime: BigInt(now - ageSecs), postedSlot: 1n });
let QUOTES: ReturnType<typeof quote>[] | undefined;

// The descriptor never changes identity once loaded — exactly the case that hid the revert.
vi.mock("./queries", () => ({
  useDeployment: () => ({ data: { listings: LISTINGS } }),
  usePrices: () => ({ data: QUOTES }),
}));
vi.mock("@wallet-standard/react", () => ({
  useWallets: () => [],
  useConnect: () => [null, vi.fn()],
  useDisconnect: () => [null, vi.fn()],
}));

const { useSelectedListing, sourceLabel } = await import("./listings");
const { SessionProvider, useSession } = await import("./wallet");

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

describe("useSelectedListing", () => {
  beforeEach(() => {
    localStorage.clear();
    QUOTES = undefined;
  });

  it("defaults to listing #0 and keeps the session on its mint", () => {
    const { result } = renderHook(() => ({ pick: useSelectedListing(), session: useSession() }), { wrapper });
    expect(result.current.pick.selected?.key).toBe("tsla");
    expect(result.current.session.listing).toBe("MintA");
  });

  it("a pick sticks: the selection, the session's mint and the saved key all move", () => {
    const { result } = renderHook(() => ({ pick: useSelectedListing(), session: useSession() }), { wrapper });
    act(() => result.current.pick.select("openai"));
    expect(result.current.pick.selected?.key).toBe("openai");
    expect(result.current.session.listing).toBe("MintB");
    expect(localStorage.getItem("thewindow:listing")).toBe("openai");
  });

  it("a saved key is honoured on the next load, and the token signature is per mint", () => {
    localStorage.setItem("thewindow:listing", "openai");
    const { result } = renderHook(() => ({ pick: useSelectedListing(), session: useSession() }), { wrapper });
    expect(result.current.pick.selected?.key).toBe("openai");
    act(() => result.current.session.setSignatures({ token: new Uint8Array(64).fill(7), tokenFor: "MintB" as never }));
    expect(result.current.session.tokenSignature?.[0]).toBe(7);
    act(() => result.current.pick.select("tsla"));
    expect(result.current.session.tokenSignature).toBeNull();
    expect(result.current.session.tokenSignatureFor("MintB" as never)?.[0]).toBe(7);
  });

  // Listing #0 is the Pyth-marked TSLAx, and Pyth's own accounts for that feed went stale. A
  // first-time visitor pressing the hero's one button used to land on the Desk holding a collateral
  // no lock could use, and the demo script had to tell a presenter to pick another by hand.
  it("opens on a collateral the chain would accept, not merely the first", () => {
    QUOTES = [quote(7 * 86_400), quote(30)]; // #0 a week old against a 1 h limit, #1 fresh
    const { result } = renderHook(() => ({ pick: useSelectedListing(), session: useSession() }), { wrapper });
    expect(result.current.pick.selected?.key).toBe("openai");
    expect(result.current.session.listing).toBe("MintB");
  });

  it("still falls back to listing #0 when none is acceptable", () => {
    QUOTES = [quote(7 * 86_400), quote(7 * 86_400)];
    const { result } = renderHook(() => useSelectedListing(), { wrapper });
    expect(result.current.selected?.key).toBe("tsla");
  });

  it("a saved pick beats a fresher listing — the choice is the reader's", () => {
    localStorage.setItem("thewindow:listing", "tsla");
    QUOTES = [quote(7 * 86_400), quote(30)];
    const { result } = renderHook(() => useSelectedListing(), { wrapper });
    expect(result.current.selected?.key).toBe("tsla");
  });
});

const sourced = (over: Partial<ListingView>): Pick<ListingView, "source" | "priceSource" | "provider"> => ({
  source: "prestocks",
  priceSource: PriceSource.Mark,
  provider: null,
  ...over,
});

describe("sourceLabel", () => {
  it("names the provider an attested mark actually reads", () => {
    expect(sourceLabel(sourced({ provider: "jupiter" }))).toBe("Jupiter mark");
    expect(sourceLabel(sourced({ provider: "prestocks" }))).toBe("PreStocks mark");
  });

  it("keeps a provider it has not met, lowercase, rather than guessing a nicer name", () => {
    expect(sourceLabel(sourced({ provider: "someone-else" }))).toBe("someone-else mark");
  });

  it("falls back to the mechanism when no provider was recorded", () => {
    // A descriptor written before providers were told apart says only this much, and saying
    // "PreStocks" here would have been a guess about which API was read.
    expect(sourceLabel(sourced({}))).toBe("attested mark");
  });

  it("says so when the program reads Pyth's own account rather than the keeper's cache", () => {
    expect(sourceLabel(sourced({ source: "pyth", priceSource: PriceSource.PythAccount }))).toBe("Pyth · on-chain");
  });

  it("names Pyth and the mock walk from the tag", () => {
    expect(sourceLabel(sourced({ source: "pyth", priceSource: PriceSource.Pyth }))).toBe("Pyth");
    expect(sourceLabel(sourced({ source: "mock", priceSource: PriceSource.Mock }))).toBe("mock walk");
  });
});
