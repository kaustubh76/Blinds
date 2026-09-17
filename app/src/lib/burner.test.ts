import {
  address,
  appendTransactionMessageInstruction,
  type Blockhash,
  compileTransaction,
  createKeyPairFromPrivateKeyBytes,
  createTransactionMessage,
  getAddressEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  verifySignature,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { beforeAll, describe, expect, it } from "vitest";

// A Map-backed localStorage so the module's storage indirection works outside a browser.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error("expected a value");
  return v;
}

const burner = await import("./burner");
const { chain } = await import("../config");

describe("burner wallet", () => {
  let addr: string;
  beforeAll(async () => {
    addr = await burner.createBurner();
  });

  it("stores a key whose address round-trips through the public key", async () => {
    expect(burner.hasBurner()).toBe(true);
    expect(burner.burnerAddress()).toBe(addr);
    const sk = burner.exportBurnerSecretHex();
    expect(sk).toMatch(/^[0-9a-f]{64}$/);
    const kp = await createKeyPairFromPrivateKeyBytes(
      Uint8Array.from(must(must(sk).match(/.{2}/g)), (x) => Number.parseInt(x, 16)),
    );
    const w = burner.burnerWallet();
    const { accounts } = await (
      w.features["standard:connect"] as {
        connect: () => Promise<{ accounts: readonly { address: string; publicKey: Uint8Array }[] }>;
      }
    ).connect();
    expect(accounts[0]?.address).toBe(addr);
    expect(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))).toEqual(accounts[0]?.publicKey);
  });

  it("satisfies the contract @solana/react checks before signing", async () => {
    const w = burner.burnerWallet();
    const account = must(w.accounts[0]);
    expect(account.chains).toContain(chain);
    expect(account.features).toEqual(expect.arrayContaining(["solana:signTransaction", "solana:signMessage"]));
    for (const f of [
      "standard:connect",
      "standard:disconnect",
      "standard:events",
      "solana:signTransaction",
      "solana:signMessage",
    ])
      expect(w.features).toHaveProperty(f);
  });

  it("signs messages that verify under the account's public key", async () => {
    const w = burner.burnerWallet();
    const msg = new TextEncoder().encode("thewindow:member:v1");
    const [out] = await (
      w.features["solana:signMessage"] as {
        signMessage: (i: {
          message: Uint8Array;
        }) => Promise<Array<{ signature: Uint8Array; signedMessage: Uint8Array }>>;
      }
    ).signMessage({ message: msg });
    expect(must(out).signedMessage).toEqual(msg);
    const pub = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(must(w.accounts[0]).publicKey),
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    expect(await verifySignature(pub, must(out).signature as never, msg)).toBe(true);
  });

  it("signs a wire transaction as fee payer", async () => {
    const w = burner.burnerWallet();
    const me = address(addr);
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(me, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: 1n },
          m,
        ),
      (m) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({ source: { address: me } as never, destination: me, amount: 1n }),
          m,
        ),
    );
    const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(msg)));
    const [out] = await (
      w.features["solana:signTransaction"] as {
        signTransaction: (i: { transaction: Uint8Array }) => Promise<Array<{ signedTransaction: Uint8Array }>>;
      }
    ).signTransaction({ transaction: wire });
    const signed = getTransactionDecoder().decode(must(out).signedTransaction);
    const sig = signed.signatures[me];
    expect(sig).toBeTruthy();
    const pub = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(getAddressEncoder().encode(me)),
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    expect(await verifySignature(pub, sig as never, signed.messageBytes)).toBe(true);
  });

  it("forgets the key", () => {
    burner.forgetBurner();
    expect(burner.hasBurner()).toBe(false);
    expect(burner.burnerWallet().accounts).toHaveLength(0);
  });
});
