import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
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
});
const LISTINGS = [listing("tsla", "MintA"), listing("openai", "MintB")];

// The descriptor never changes identity once loaded — exactly the case that hid the revert.
vi.mock("./queries", () => ({ useDeployment: () => ({ data: { listings: LISTINGS } }) }));
vi.mock("@wallet-standard/react", () => ({
  useWallets: () => [],
  useConnect: () => [null, vi.fn()],
  useDisconnect: () => [null, vi.fn()],
}));

const { useSelectedListing } = await import("./listings");
const { SessionProvider, useSession } = await import("./wallet");

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

describe("useSelectedListing", () => {
  beforeEach(() => localStorage.clear());

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
});
