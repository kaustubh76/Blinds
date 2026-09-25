/**
 * A devnet burner: a throwaway Ed25519 key kept in this browser's localStorage and exposed to the
 * app as a Wallet Standard wallet, so every flow (derive keys, wrap, bid, lock) runs with zero
 * prompts and no extension. Anyone with access to this browser profile can use the key; it is
 * only ever registered for devnet/localnet, and the app has no mainnet configuration.
 */
import {
  type Address,
  createKeyPairFromPrivateKeyBytes,
  getAddressEncoder,
  getAddressFromPublicKey,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  signBytes,
} from "@solana/kit";
import { getWallets } from "@wallet-standard/app";
import { chain, config } from "../config";

type Wallet = Parameters<ReturnType<typeof getWallets>["register"]>[0];
type WalletAccount = Wallet["accounts"][number];

export const BURNER_WALLET_NAME = "Devnet burner (this browser)";
export const BURNER_STORAGE_KEY = `thewindow:burner:${config.cluster}`;

interface Stored {
  sk: string;
  address: string;
}

const enc = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const dec = (h: string) => Uint8Array.from(h.match(/.{2}/g) ?? [], (x) => Number.parseInt(x, 16));

/** Storage indirection so the node tests can run without a DOM. */
export const storage = {
  get: (): Stored | null => {
    try {
      const raw = localStorage.getItem(BURNER_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Stored) : null;
    } catch {
      return null;
    }
  },
  set: (s: Stored | null) => {
    try {
      if (s) localStorage.setItem(BURNER_STORAGE_KEY, JSON.stringify(s));
      else localStorage.removeItem(BURNER_STORAGE_KEY);
    } catch {
      // storage unavailable: the burner lives for this page load only
    }
  },
};

let keyPair: CryptoKeyPair | null = null;
let keyAddress: Address | null = null;
let accounts: readonly WalletAccount[] = [];
const listeners = new Set<(props: { accounts: readonly WalletAccount[] }) => void>();

function emit() {
  for (const l of listeners) l({ accounts });
}

async function load(): Promise<{ keyPair: CryptoKeyPair; address: Address } | null> {
  if (keyPair && keyAddress) return { keyPair, address: keyAddress };
  const s = storage.get();
  if (!s) return null;
  keyPair = await createKeyPairFromPrivateKeyBytes(dec(s.sk));
  keyAddress = await getAddressFromPublicKey(keyPair.publicKey);
  return { keyPair, address: keyAddress };
}

export function hasBurner(): boolean {
  return storage.get() !== null;
}

export function burnerAddress(): Address | null {
  const s = storage.get();
  return s ? (s.address as Address) : null;
}

/** Generates a fresh key (replacing any stored one) and returns its address. */
export async function createBurner(): Promise<Address> {
  const sk = new Uint8Array(32);
  crypto.getRandomValues(sk);
  return adoptBurner(enc(sk));
}

/**
 * Takes on a secret exported from another browser, replacing any stored one, and returns the address
 * it derives — so a member can carry a position between devices instead of losing it.
 */
export async function adoptBurner(secretHex: string): Promise<Address> {
  const hex = secretHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("a burner secret is 32 bytes: 64 hex characters");
  keyPair = await createKeyPairFromPrivateKeyBytes(dec(hex));
  keyAddress = await getAddressFromPublicKey(keyPair.publicKey);
  storage.set({ sk: hex, address: keyAddress });
  accounts = [];
  emit();
  return keyAddress;
}

export function forgetBurner(): void {
  storage.set(null);
  keyPair = null;
  keyAddress = null;
  accounts = [];
  emit();
}

/** The raw 32-byte secret as hex — shown only when the user asks, never logged. */
export function exportBurnerSecretHex(): string | null {
  return storage.get()?.sk ?? null;
}

function accountFor(address: Address): WalletAccount {
  return {
    address,
    publicKey: new Uint8Array(getAddressEncoder().encode(address)),
    chains: [chain],
    features: ["solana:signTransaction", "solana:signMessage"],
    label: "Devnet burner",
  };
}

const ICON =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#131519"/><path d="M16 5c3 4 6 7 6 12a6 6 0 0 1-12 0c0-2 .8-3.6 2-5 .3 1.6 1 2.6 2 3 0-4 1-7 2-10Z" fill="#a78bfa"/></svg>',
  );

/** The Wallet Standard object; built once. */
export function burnerWallet(): Wallet {
  return {
    version: "1.0.0",
    name: BURNER_WALLET_NAME,
    icon: ICON as Wallet["icon"],
    chains: [chain],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          const k = (await load()) ?? (await createBurner().then(load));
          if (!k) throw new Error("burner key unavailable");
          accounts = [accountFor(k.address)];
          emit();
          return { accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          accounts = [];
          emit();
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (_event: "change", listener: (props: { accounts: readonly WalletAccount[] }) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: Array<{ transaction: Uint8Array }>) => {
          const k = await load();
          if (!k) throw new Error("burner key missing — create one first");
          return Promise.all(
            inputs.map(async (i) => {
              const tx = getTransactionDecoder().decode(i.transaction);
              const signed = await partiallySignTransaction([k.keyPair], tx);
              return { signedTransaction: new Uint8Array(getTransactionEncoder().encode(signed)) };
            }),
          );
        },
      },
      "solana:signMessage": {
        version: "1.1.0",
        signMessage: async (...inputs: Array<{ message: Uint8Array }>) => {
          const k = await load();
          if (!k) throw new Error("burner key missing — create one first");
          return Promise.all(
            inputs.map(async (i) => ({
              signedMessage: i.message,
              signature: new Uint8Array(await signBytes(k.keyPair.privateKey, i.message)),
              signatureType: "ed25519" as const,
            })),
          );
        },
      },
    },
  };
}

let registered = false;
/** Registers the burner with the page's wallet registry (idempotent). Never on a mainnet cluster. */
export function registerBurnerWallet(): void {
  if (registered) return;
  if (config.cluster !== "devnet" && config.cluster !== "localnet") return;
  registered = true;
  getWallets().register(burnerWallet());
}

/** Signs with the burner key directly (used by tests and by code paths that hold no UI account). */
export async function burnerSign(message: Uint8Array): Promise<Uint8Array> {
  const k = await load();
  if (!k) throw new Error("burner key missing");
  return new Uint8Array(await signBytes(k.keyPair.privateKey, message));
}
