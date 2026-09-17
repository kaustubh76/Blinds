/**
 * Wallet session. The selected wallet-standard account plus the two wallet signatures the desk
 * derives its confidential keys from (member key, cSTOCK-W token-account key). Signatures are
 * secret material: they live in React state only and are never persisted or sent anywhere.
 */

import { type Address, address } from "@solana/kit";
import { useSignMessage, useWalletAccountTransactionSigner } from "@solana/react";
import { memberSigningMessage, tokenAccountSigningMessage } from "@thewindow/solana-sdk";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import { useConnect, useDisconnect, useWallets } from "@wallet-standard/react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { chain } from "../config";

export interface Session {
  wallets: readonly UiWallet[];
  wallet: UiWallet | null;
  account: UiWalletAccount | null;
  address: Address | null;
  connect: (w: UiWallet) => Promise<void>;
  disconnect: () => Promise<void>;
  /** 64-byte signature over the member derivation message (bids, loans). */
  memberSignature: Uint8Array | null;
  /** The selected listing's cSTOCK mint (set by the desk); token signatures are kept per mint. */
  listing: Address | null;
  setListing: (cstockMint: Address | null) => void;
  /** 64-byte signature over the token-account derivation message for the selected listing's cSTOCK-W account. */
  tokenSignature: Uint8Array | null;
  /** The same, for any listing's cSTOCK mint (a loan may be bound to a listing other than the selected one). */
  tokenSignatureFor: (cstockMint: Address) => Uint8Array | null;
  setSignatures: (s: { member?: Uint8Array; token?: Uint8Array; tokenFor?: Address }) => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const wallets = useWallets();
  const [account, setAccount] = useState<UiWalletAccount | null>(null);
  const [wallet, setWallet] = useState<UiWallet | null>(null);
  const [memberSignature, setMember] = useState<Uint8Array | null>(null);
  const [tokenSignatures, setTokens] = useState<Record<string, Uint8Array>>({});
  const [listing, setListingState] = useState<Address | null>(null);

  const connect = useCallback(async (w: UiWallet) => {
    // useConnect is a hook; connect through the wallet's feature directly to keep this callback generic.
    const accounts = await connectWallet(w);
    const preferred = accounts.find((a) => a.chains.includes(chain)) ?? accounts[0] ?? null;
    setWallet(w);
    setAccount(preferred);
    setMember(null);
    setTokens({});
  }, []);
  const disconnect = useCallback(async () => {
    if (wallet) await disconnectWallet(wallet);
    setWallet(null);
    setAccount(null);
    setMember(null);
    setTokens({});
  }, [wallet]);
  const setSignatures = useCallback(
    (s: { member?: Uint8Array; token?: Uint8Array; tokenFor?: Address }) => {
      if (s.member) setMember(s.member);
      if (s.token) {
        const key = s.tokenFor ?? listing ?? "";
        setTokens((prev) => ({ ...prev, [key]: s.token as Uint8Array }));
      }
    },
    [listing],
  );
  const setListing = useCallback((m: Address | null) => setListingState(m), []);
  const tokenSignatureFor = useCallback((m: Address) => tokenSignatures[m] ?? null, [tokenSignatures]);

  const value = useMemo<Session>(
    () => ({
      wallets,
      wallet,
      account,
      address: account ? address(account.address) : null,
      connect,
      disconnect,
      memberSignature,
      listing,
      setListing,
      tokenSignature: listing ? (tokenSignatures[listing] ?? null) : null,
      tokenSignatureFor,
      setSignatures,
    }),
    [
      wallets,
      wallet,
      account,
      connect,
      disconnect,
      memberSignature,
      listing,
      setListing,
      tokenSignatures,
      tokenSignatureFor,
      setSignatures,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("SessionProvider missing");
  return s;
}

/** Hooks that need a connected account; render these components only when `account` is set. */
export function useAccountSigners(account: UiWalletAccount) {
  const txSigner = useWalletAccountTransactionSigner(account, chain);
  const signMessage = useSignMessage(account);
  const signMember = useCallback(async () => {
    const out = await signMessage({ message: memberSigningMessage() });
    return new Uint8Array(out.signature);
  }, [signMessage]);
  const signToken = useCallback(
    async (tokenAccountBytes: Uint8Array) => {
      const out = await signMessage({ message: tokenAccountSigningMessage(tokenAccountBytes) });
      return new Uint8Array(out.signature);
    },
    [signMessage],
  );
  return { txSigner, signMember, signToken };
}

/** Thin imperative wrappers so the session can connect any wallet without a per-wallet hook. */
function ConnectBridge({ wallet, onReady }: { wallet: UiWallet; onReady: (fns: Bridge) => void }) {
  const [, connect] = useConnect(wallet);
  const [, disconnect] = useDisconnect(wallet);
  onReady({ connect: () => connect(), disconnect: () => disconnect() });
  return null;
}
interface Bridge {
  connect: () => Promise<readonly UiWalletAccount[]>;
  disconnect: () => Promise<void>;
}
const bridges = new Map<string, Bridge>();
export function WalletBridges() {
  const wallets = useWallets();
  return (
    <>
      {wallets.map((w) => (
        <ConnectBridge key={w.name} wallet={w} onReady={(b) => bridges.set(w.name, b)} />
      ))}
    </>
  );
}
async function connectWallet(w: UiWallet) {
  const b = bridges.get(w.name);
  if (!b) throw new Error(`wallet ${w.name} not ready`);
  return b.connect();
}
async function disconnectWallet(w: UiWallet) {
  await bridges.get(w.name)?.disconnect();
}
