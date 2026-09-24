import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const disconnect = vi.fn(async () => {});
const connect = vi.fn(async () => {});
const session = {
  wallets: [] as Array<{ name: string; icon: string }>,
  wallet: null as { name: string } | null,
  account: null as { address: string; chains: string[] } | null,
  connect,
  disconnect,
};
vi.mock("../lib/wallet", () => ({ useSession: () => session }));
vi.mock("../lib/burner", () => ({
  BURNER_WALLET_NAME: "Devnet burner",
  burnerAddress: () => "Burner1111111111111111111111111111111111111",
  createBurner: vi.fn(async () => {}),
  hasBurner: () => true,
}));

const { WalletButton } = await import("./WalletButton");

const ADDRESS = "3bku8abYECxZxfoXDsTjcCCBv7JMF6BKTREeJLeVDnJX";
const burnerWallet = { name: "Devnet burner", icon: "" };

function connected(chains = ["solana:devnet"]) {
  session.account = { address: ADDRESS, chains };
  session.wallet = { name: "Devnet burner" };
  session.wallets = [burnerWallet];
}
function disconnected() {
  session.account = null;
  session.wallet = null;
  session.wallets = [burnerWallet];
}

describe("WalletButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disconnected();
  });

  it("offers Connect when there is no account, and keeps the menu shut until asked", () => {
    render(<WalletButton />);
    expect(screen.getByRole("button", { name: /connect/i })).toBeTruthy();
    expect(screen.queryByText(/devnet burner/i)).toBeNull();
  });

  it("shows a short address once connected, never the full one in the header", () => {
    connected();
    const { container } = render(<WalletButton />);
    expect(screen.getByText("3bku…DnJX")).toBeTruthy();
    // The full 44-character address belongs in the menu; in the header it would not fit a phone.
    expect(container.textContent).not.toContain(ADDRESS);
  });

  it("puts the full address and Disconnect in the menu", () => {
    connected();
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /3bku/ }));
    expect(screen.getByText(ADDRESS)).toBeTruthy();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
  });

  it("disconnects and closes", () => {
    connected();
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /3bku/ }));
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(screen.queryByText(ADDRESS)).toBeNull();
  });

  it("announces itself as a menu, open and shut", () => {
    connected();
    render(<WalletButton />);
    const trigger = screen.getByRole("button", { name: /3bku/ });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape", () => {
    connected();
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: /3bku/ }));
    expect(screen.getByText(ADDRESS)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(ADDRESS)).toBeNull();
  });

  it("closes on a click outside, and the trigger itself still toggles", () => {
    connected();
    render(<WalletButton />);
    const trigger = screen.getByRole("button", { name: /3bku/ });
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText(ADDRESS)).toBeNull();
    // A mousedown on the trigger must not be treated as "outside", or it would close and reopen.
    fireEvent.click(trigger);
    fireEvent.mouseDown(trigger);
    expect(screen.getByText(ADDRESS)).toBeTruthy();
  });

  // A wallet with no account on this chain used to say so in the header; behind a menu the warning
  // was invisible until every signature failed for no stated reason.
  it("marks the chip when the wallet has no account on this chain", () => {
    connected(["solana:mainnet"]);
    render(<WalletButton />);
    const trigger = screen.getByRole("button", { name: /3bku/ });
    expect(trigger.className).toContain("status-warning");
    fireEvent.click(trigger);
    expect(screen.getByText(/signing will fail/i)).toBeTruthy();
  });
});
