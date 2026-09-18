/**
 * The desk's Pyth poster (Stage 4 of docs/TRACKS.md).
 *
 * Pyth publishes `Crypto.TSLAX/USD` on mainnet; the desk runs on devnet. This process carries the
 * feed across the same way any Pyth consumer does: it fetches the latest signed update (a Wormhole
 * VAA) from Hermes with the desk's API key and posts it to the **Pyth receiver program on devnet**,
 * which verifies the guardian signatures and writes a `PriceUpdateV2` into the push-oracle PDA
 * `[shard, feed_id]`. From then on `window_credit` reads that receiver-owned account directly for a
 * `price_source = 4` listing — the keeper never touches the number.
 *
 * Reads config/<profile>.toml for the listings that name a `pyth_shard`; every POST_EVERY_SECS it
 * posts each of them (one transaction per feed; `closeUpdateAccounts: false` keeps the PDA).
 * Signer = WINDOW_ADMIN_KEYPAIR (the disclosed admin key), fees ≈ 0.00001 SOL per post plus the
 * PDA's rent once (≈ 0.002 SOL).
 *
 *   PYTH_API_KEY=… pnpm --filter @thewindow/pyth-poster start          # loop
 *   PYTH_API_KEY=… pnpm --filter @thewindow/pyth-poster once           # one post, then exit
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { HermesClient } from "@pythnetwork/hermes-client";
import type { PythSolanaReceiver as PythSolanaReceiverT } from "@pythnetwork/pyth-solana-receiver";
import { Connection, Keypair, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { parse as parseToml } from "smol-toml";

// The receiver's ESM build reaches jito-ts through extensionless imports Node refuses; its CJS
// build loads cleanly, so it is required rather than imported.
const { PythSolanaReceiver } = createRequire(import.meta.url)(
  "@pythnetwork/pyth-solana-receiver",
) as typeof import("@pythnetwork/pyth-solana-receiver");
type PythSolanaReceiver = PythSolanaReceiverT;

const ROOT = resolve(import.meta.dirname, "../../..");
// The repo's .env (the same file scripts/market.sh sources), for a bare `pnpm … once`.
try {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m?.[1] && m[2] !== undefined && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // no .env: the environment must carry the settings
}
const CLUSTER = process.env.WINDOW_CLUSTER ?? "devnet";
const PROFILE = process.env.WINDOW_PROFILE ?? CLUSTER;
const RPC_URL =
  process.env.WINDOW_RPC_URL ?? (CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899");
const HERMES_URL = process.env.PYTH_HERMES_URL ?? "https://pyth.dourolabs.app/hermes";
const POST_EVERY_SECS = Number(process.env.PYTH_POST_EVERY_SECS ?? 60);
const ONCE = process.argv.includes("--once");

interface ListingCfg {
  key: string;
  symbol: string;
  source: string;
  pyth_feed_id?: string;
  pyth_shard?: number;
}

function keypair(): Keypair {
  const path = (process.env.WINDOW_ADMIN_KEYPAIR ?? "~/.config/solana/id.json").replace(/^~/, homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

function listings(): Array<Required<Pick<ListingCfg, "key" | "symbol" | "pyth_feed_id" | "pyth_shard">>> {
  const profile = parseToml(readFileSync(resolve(ROOT, `config/${PROFILE}.toml`), "utf8")) as {
    listings?: ListingCfg[];
  };
  return (profile.listings ?? [])
    .filter((l) => l.source === "pyth" && l.pyth_shard !== undefined && l.pyth_feed_id)
    .map((l) => ({
      key: l.key,
      symbol: l.symbol,
      pyth_feed_id: (l.pyth_feed_id as string).replace(/^0x/, ""),
      pyth_shard: l.pyth_shard as number,
    }));
}

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }));

async function postAll(
  receiver: PythSolanaReceiver,
  hermes: HermesClient,
  targets: ReturnType<typeof listings>,
  connection: Connection,
): Promise<void> {
  for (const t of targets) {
    try {
      const update = await hermes.getLatestPriceUpdates([t.pyth_feed_id], { encoding: "base64" });
      const data = update.binary.data;
      const parsed = update.parsed?.[0];
      const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: false });
      await builder.addUpdatePriceFeed(data, t.pyth_shard);
      const txs = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50_000 });
      const sigs = await receiver.provider.sendAll(txs, { skipPreflight: false, maxRetries: 3 });
      const account = receiver.getPriceFeedAccountAddress(t.pyth_shard, t.pyth_feed_id);
      const slot = await connection.getSlot("confirmed");
      log("posted", {
        listing: t.key,
        symbol: t.symbol,
        shard: t.pyth_shard,
        account: account.toBase58(),
        price: parsed?.price.price,
        expo: parsed?.price.expo,
        publish_time: parsed?.price.publish_time,
        age_secs: parsed ? Math.floor(Date.now() / 1000) - parsed.price.publish_time : null,
        slot,
        signatures: sigs,
      });
    } catch (e) {
      log("post failed", { listing: t.key, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.PYTH_API_KEY) {
    console.error("PYTH_API_KEY is not set: Hermes needs it for signed updates. Nothing to do.");
    process.exit(2);
  }
  const targets = listings();
  if (targets.length === 0) {
    console.error(`no listing in config/${PROFILE}.toml names a pyth_shard; nothing to post`);
    process.exit(2);
  }
  const wallet = keypair();
  const connection = new Connection(RPC_URL, "confirmed");
  const hermes = new HermesClient(HERMES_URL, {
    headers: { Authorization: `Bearer ${process.env.PYTH_API_KEY}` },
  });
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if ("version" in tx) tx.sign([wallet]);
    else tx.partialSign(wallet);
    return tx;
  };
  const receiver = new PythSolanaReceiver({
    connection,
    wallet: {
      publicKey: wallet.publicKey,
      signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => sign(tx),
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs.map(sign),
    },
  });
  log("pyth-poster up", {
    cluster: CLUSTER,
    rpc: RPC_URL,
    hermes: HERMES_URL,
    signer: wallet.publicKey.toBase58(),
    receiver: receiver.receiver.programId.toBase58(),
    targets: targets.map((t) => ({
      listing: t.key,
      shard: t.pyth_shard,
      account: receiver.getPriceFeedAccountAddress(t.pyth_shard, t.pyth_feed_id).toBase58(),
    })),
    every_secs: POST_EVERY_SECS,
  });
  const lamports = await connection.getBalance(wallet.publicKey);
  if (lamports < 20_000_000) log("low balance", { sol: lamports / 1e9 });
  for (;;) {
    await postAll(receiver, hermes, targets, connection);
    if (ONCE) return;
    await new Promise((r) => setTimeout(r, POST_EVERY_SECS * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
