import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `usePositions` returns a plain object, so the page can be rendered with fabricated loans — this is
// the only way to reach it in a test: it needs a connected wallet holding a loan to render at all.
const state = {
  wallet: "BorrowerWa11et1111111111111111111111111111111",
  dep: { data: { faucet: true } },
  loans: { data: { borrowed: [] as unknown[], lent: [] as unknown[] } },
  credit: { data: null },
  listings: [] as unknown[],
  selectedListing: null,
  selectListing: vi.fn(),
  steps: { steps: [], reset: vi.fn(), onStep: vi.fn() },
  lock: { error: null, isPending: false, mutate: vi.fn() },
  deposit: { error: null, isPending: false, mutate: vi.fn() },
  receiveAccount: { error: null as Error | null, isPending: false, mutate: vi.fn() },
  deriveKeys: { isPending: false, mutate: vi.fn() },
  keysReady: true,
};
vi.mock("./usePositions", () => ({ usePositions: () => state }));
vi.mock("../../lib/queries", () => ({ useBids: () => ({ data: [] }), useSlot: () => ({ data: 1_000 }) }));
vi.mock("../../lib/wallet", () => ({
  useSession: () => ({ account: { address: "BorrowerWa11et1111111111111111111111111111111", chains: [] } }),
}));

const { Positions } = await import("./Positions");
const { LoanStatus } = await import("@thewindow/solana-sdk");

const loan = (over: Record<string, unknown> = {}) =>
  ({
    borrower: "BorrowerWa11et1111111111111111111111111111111",
    lender: "Lender1111111111111111111111111111111111111",
    listing: "UnknownListingPda11111111111111111111111111",
    status: LoanStatus.Defaulted,
    collateralReleased: false,
    tick: 14,
    epoch: 2n,
    k: 0,
    deadlineSlot: 0n,
    priceAtLock: 40_031n,
    fillNum: 1n,
    fillDen: 1n,
    sizeCt: new Uint8Array(64),
    collateralCt: new Uint8Array(64),
    ...over,
  }) as unknown;

function reset() {
  state.loans.data = { borrowed: [], lent: [] };
  state.receiveAccount.error = null;
  state.listings = [];
}

describe("Positions", () => {
  // A lender's failure used to print inside the borrowing card, under "No loans as a borrower yet",
  // because one shared step list and one shared error were rendered there.
  it("keeps a lender's error out of the borrowing card", () => {
    reset();
    state.receiveAccount.error = new Error("the payout account could not be created");
    render(<Positions />);
    const borrowing = screen.getByText("borrowing").closest("section, div[class*='rounded']");
    expect(borrowing).not.toBeNull();
    expect(within(borrowing as HTMLElement).queryByText(/payout account could not be created/)).toBeNull();
    // It is still on the page — it belongs to the page, not to either card.
    expect(screen.getByText(/payout account could not be created/)).toBeTruthy();
  });

  // Without a known listing the whole branch was skipped and the chain fell through to `null`, so a
  // lender saw a loan card with no action and no reason.
  it("explains a defaulted loan whose listing this deployment does not carry", () => {
    reset();
    state.loans.data = { borrowed: [], lent: [{ address: "Loan111", data: loan() }] };
    render(<Positions />);
    expect(screen.getByText(/listing this dashboard does not know/)).toBeTruthy();
  });

  it("still offers the payout when the listing is known", () => {
    reset();
    state.listings = [
      { listing: "UnknownListingPda11111111111111111111111111", symbol: "TSLAx-mock", haircutBps: 15_000n },
    ];
    state.loans.data = { borrowed: [], lent: [{ address: "Loan111", data: loan() }] };
    render(<Positions />);
    expect(screen.getByRole("button", { name: /receive the payout/i })).toBeTruthy();
    expect(screen.queryByText(/listing this dashboard does not know/)).toBeNull();
  });
});
