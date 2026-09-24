import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import { describe, expect, it } from "vitest";
import { liveAccountOf } from "./wallet";

const acct = (address: string) => ({ address, chains: ["solana:devnet"] }) as unknown as UiWalletAccount;
const wallet = (name: string, ...accounts: UiWalletAccount[]) => ({ name, accounts }) as unknown as UiWallet;

const A = acct("Aaa11111111111111111111111111111111111111111");
const B = acct("Bbb22222222222222222222222222222222222222222");

describe("liveAccountOf", () => {
  it("keeps an account its wallet still holds", () => {
    expect(liveAccountOf([wallet("Burner", A)], A)).toBe(A);
  });

  it("has nothing to keep when nothing is connected", () => {
    expect(liveAccountOf([wallet("Burner", A)], null)).toBeNull();
  });

  // Disconnecting — here or from the extension's own window — drops the account from the registry.
  // Anything still holding it throws WALLET_ACCOUNT_NOT_FOUND mid-render, which is an error screen
  // rather than a message, so the session must stop offering it in the very same render.
  it("lets go when the wallet has dropped the account", () => {
    expect(liveAccountOf([wallet("Burner")], A)).toBeNull();
  });

  it("lets go when the wallet itself is gone", () => {
    expect(liveAccountOf([], A)).toBeNull();
  });

  it("does not mistake another wallet's account for its own", () => {
    expect(liveAccountOf([wallet("Other", B)], A)).toBeNull();
  });

  it("finds the account whichever wallet holds it", () => {
    expect(liveAccountOf([wallet("Other", B), wallet("Burner", A)], A)).toBe(A);
  });
});
