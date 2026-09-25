/**
 * Live recipes: each one is a snippet a developer can copy *and* the same call run in this tab
 * against the configured RPC. `code` and `run` sit side by side on purpose — a test checks that
 * every `sdk.X` the run calls is named in the snippet, so the text never drifts from what executes.
 */
import { type Address, isAddress } from "@solana/kit";
import type * as SDK from "@thewindow/solana-sdk";
import type { Resolved } from "../../config";
import { type DeploymentView, fetchDeployment } from "../../lib/chain";
import { LAUNCH, launchCluster } from "../../lib/launch";
import { startLive } from "../../lib/live";
import { basisBps, FEEDS, fetchFreshest, mainnetRpc, nyseSession, PYTH_RECEIVER } from "../../lib/pyth";
import { DEFAULT_WRAP_SHARES, type useDesk } from "../desk/useDesk";
import { quoteAddress, quoteSourceFor } from "./quotes";

export interface RecipeCtx {
  sdk: typeof SDK;
  rpc: SDK.RpcClient;
  config: Resolved;
  deployment: DeploymentView | null;
  wallet: Address | null;
  /** Only the member signature is needed by a recipe; it is used, never printed. */
  memberSignature: Uint8Array | null;
  rentFor: (space: number) => Promise<bigint>;
  signal: AbortSignal;
  log: (line: string) => void;
  /** The recipe's own parameters, as typed on the page. Read through these, never as literals. */
  p: Params;
  /**
   * The Desk's flows, when a wallet is connected — how a write recipe writes. It is the *same* object
   * the Desk uses, so a bid sent from here goes through `buildBidPlan` → `sendPlan` → the console
   * exactly as one sent from the Desk does; there is no second code path to keep in step.
   */
  desk: Desk | null;
  /** True when the page asked for a dry run: build the plan, report it, send nothing. */
  dryRun: boolean;
}

/**
 * `useDesk`'s return value — what a write recipe drives the chain through. The import is real rather
 * than type-only (the wrap default is a value), which is safe because `useDesk` imports nothing from
 * here: the dependency runs one way, from the recipes to the Desk.
 */
export type Desk = ReturnType<typeof useDesk>;

export interface Choice {
  value: string;
  label: string;
}

/**
 * A parameter a developer can change before running. The spec is the single source of truth: the
 * page renders the input from it, and both `code` and `run` read the value through `ctx.p`, so the
 * snippet cannot show one number while the run uses another.
 */
export type ParamSpec =
  | { key: string; kind: "int"; label: string; default: number; min?: number; max?: number; hint?: string }
  /** Whole USDC on the page; `p.big` hands back micro-USDC. */
  | { key: string; kind: "usdc"; label: string; default: number; hint?: string }
  /** `example` is a value known to be valid — the placeholder, and what a test varies it to. */
  | { key: string; kind: "text"; label: string; default: string; placeholder?: string; example?: string; hint?: string }
  | {
      key: string;
      kind: "choice";
      label: string;
      default: string;
      choices: (ctx: RecipeCtx) => Choice[];
      hint?: string;
    };

export interface Params {
  int(key: string): number;
  /** A `usdc` parameter in micro-USDC; anything else parsed as a bigint. */
  big(key: string): bigint;
  str(key: string): string;
  /** Every value as it stands, for a snippet that wants to show them together. */
  all(): Readonly<Record<string, string>>;
}

/** The values a recipe starts with, before anyone types anything. */
export function defaultValues(specs: readonly ParamSpec[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sp of specs ?? []) out[sp.key] = String(sp.default);
  return out;
}

/**
 * The accessor the recipes read. A blank or unparseable value falls back to the spec's default rather
 * than throwing mid-run: a half-typed number in an input is not an error worth a stack trace.
 */
export function makeParams(specs: readonly ParamSpec[] | undefined, values: Record<string, string>): Params {
  const spec = (key: string) => (specs ?? []).find((x) => x.key === key);
  const raw = (key: string) => {
    const v = values[key];
    const sp = spec(key);
    if (v === undefined || v === "") return sp === undefined ? "" : String(sp.default);
    return v;
  };
  return {
    int(key) {
      const sp = spec(key);
      const n = Number(raw(key));
      if (!Number.isFinite(n)) return sp && sp.kind !== "text" && sp.kind !== "choice" ? Number(sp.default) : 0;
      const clamped =
        sp?.kind === "int" ? Math.min(sp.max ?? Number.MAX_SAFE_INTEGER, Math.max(sp.min ?? -Infinity, n)) : n;
      return Math.trunc(clamped);
    },
    big(key) {
      const sp = spec(key);
      const text = raw(key);
      if (sp?.kind === "usdc") {
        const n = Number(text);
        return BigInt(Math.max(0, Math.round(Number.isFinite(n) ? n : sp.default))) * 1_000_000n;
      }
      try {
        return BigInt(text.replace(/[_,\s]/g, ""));
      } catch {
        return 0n;
      }
    },
    str(key) {
      return raw(key);
    },
    all() {
      const out: Record<string, string> = {};
      for (const sp of specs ?? []) out[sp.key] = raw(sp.key);
      return out;
    },
  };
}

export interface Recipe {
  id: string;
  title: string;
  blurb: string;
  needs?: "wallet" | "keys";
  /** Declared so the page can render inputs; read in `code` and `run` through `ctx.p`. */
  params?: readonly ParamSpec[];
  /**
   * This recipe sends transactions. The card says so, asks before the first send, and offers a dry
   * run (and, for a single-transaction plan, a real simulation) beside it.
   */
  writes?: boolean;
  code: (ctx: RecipeCtx) => string;
  run: (ctx: RecipeCtx) => Promise<unknown>;
}

/**
 * The mark labels worth offering: `prestocks:ANTHROPIC` always (it is what this recipe is about, and a
 * localnet descriptor has no attested-mark listing at all), then whatever the loaded descriptor names.
 */
function markLabels(dep: DeploymentView | null): Choice[] {
  const seen = new Set<string>();
  const out: Choice[] = [];
  const add = (value: string, label: string) => {
    if (seen.has(value)) return;
    seen.add(value);
    out.push({ value, label });
  };
  add("prestocks:ANTHROPIC", "prestocks:ANTHROPIC");
  for (const l of dep?.listings ?? [])
    add(`${l.source}:${l.symbol.replace(/-mock$/, "")}`, `${l.symbol} · ${l.source}`);
  return out;
}

/**
 * The wallet a recipe should read: the one typed in, else the one connected. Typing an address makes
 * the recipe work with no wallet at all, which is how you look at someone else's public record.
 */
function askedWallet(ctx: RecipeCtx, key: string): Address | null {
  const typed = ctx.p.str(key).trim();
  if (typed && isAddress(typed)) return typed;
  return ctx.wallet;
}

/** The `shares` parameter in the collateral mint's own base units (milli-shares at 3 decimals). */
function shares(ctx: RecipeCtx): bigint {
  const decimals = ctx.desk?.listing?.decimals ?? ctx.deployment?.decimals ?? 3;
  return BigInt(ctx.p.int("shares")) * 10n ** BigInt(decimals);
}

/** A typed epoch, or `null` for "whatever the oracle last printed". */
function chosenEpoch(ctx: RecipeCtx, key: string): bigint | null {
  const raw = ctx.p.str(key).trim();
  if (!/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

const PRELUDE = (ctx: RecipeCtx) =>
  `import * as sdk from "@thewindow/solana-sdk";
import { createSolanaRpc } from "@solana/kit";
const rpc = createSolanaRpc("${ctx.config.rpcUrl}");`;

export const RECIPES: Recipe[] = [
  {
    id: "config",
    title: "Read the market",
    blurb: "The three config accounts and the PDAs everything hangs off.",
    code: (ctx) => `${PRELUDE(ctx)}

const auction = await sdk.fetchAuctionConfig(rpc);   // epoch length, sMin, current epoch, hasOpenEpoch
const credit  = await sdk.fetchCreditConfig(rpc);    // haircut, tenor, escrow, price feed
const oracle  = await sdk.fetchOracle(rpc);          // last print, τ, stale flag
const listings = await sdk.fetchListings(rpc);       // the collateral schedule (see the "schedule" recipe)
const pdas = {
  auctionConfig: await sdk.pda.auctionConfig(),
  epoch: await sdk.pda.epoch(auction.currentEpoch),
  print: await sdk.pda.print(auction.currentEpoch),
};
console.log(sdk.PROGRAMS, auction, credit, oracle, pdas, listings.length, "listings");`,
    run: async (ctx) => {
      const [auction, credit, oracle] = await Promise.all([
        ctx.sdk.fetchAuctionConfig(ctx.rpc),
        ctx.sdk.fetchCreditConfig(ctx.rpc),
        ctx.sdk.fetchOracle(ctx.rpc),
      ]);
      if (!auction) throw new Error("auction config missing — is the RPC pointed at a deployment?");
      const pdas = {
        auctionConfig: await ctx.sdk.pda.auctionConfig(),
        epoch: await ctx.sdk.pda.epoch(auction.currentEpoch),
        print: await ctx.sdk.pda.print(auction.currentEpoch),
      };
      const listings = await ctx.sdk.fetchListings(ctx.rpc);
      return { programs: ctx.sdk.PROGRAMS, auction, credit, oracle, pdas, listings: listings.length };
    },
  },
  {
    id: "schedule",
    title: "The collateral schedule, as the chain would judge it now",
    blurb: "Every Listing, its PriceCache and the two freshness rules the chain enforces.",
    code: (ctx) => `${PRELUDE(ctx)}

const descriptor = await (await fetch("${ctx.config.adminUrl || "https://<admin>"}/deployment")).json(); // = deployments/devnet.json
const listings = await sdk.fetchListings(rpc);                       // every Listing account, sorted by symbol
const sources  = listings.map(({ address, data: l }) => ({          // where the program reads each quote:
  feedId: new Uint8Array(l.feedId), priceSource: l.priceSource,     //   the cache PDA (sources 0-3), or the
  priceAccount: descriptor.listings.find((d) => d.listing === address)?.price_account ?? null, // Pyth account (source 4)
}));
const quotes   = await sdk.fetchQuotes(rpc, sources);                // one RPC call, decoded per source
const slot     = Number(await rpc.getSlot({ commitment: "confirmed" }).send());
const now      = Number(await rpc.getBlockTime(BigInt(slot)).send());
for (const [i, { address, data: l }] of listings.entries()) {
  const price = quotes[i];
  if (!price) { console.log(sdk.symbolOf(l), "no usable quote at", await sdk.quoteAccount(sources[i])); continue; }
  const f = sdk.quoteFreshness({ listing: l, price, slot, nowSecs: now });
  console.log(sdk.symbolOf(l), sdk.PRICE_SOURCE_NAMES[l.priceSource], sdk.isAttestedMark(l.priceSource) ? "(attested mark)" : "",
    "mark", Number(price.price) * 10 ** price.expo, "haircut", Number(l.haircutBps) / 100 + "%",
    "quote", f.quoteAgeSecs + "s old (limit " + l.maxPublishAgeSecs + ")", "posted", f.postedAgeSlots + " slots ago (limit " + l.maxPriceAge + ")",
    f.usable ? "→ lock/seize ACCEPTED" : "→ REFUSED", "listing", address, "read from", price.from, await sdk.quoteAccount(sources[i]));
}`,
    run: async (ctx) => {
      const listings = await ctx.sdk.fetchListings(ctx.rpc);
      const deployment = ctx.deployment ?? (await fetchDeployment());
      const sources = listings.map(({ address, data: l }) => quoteSourceFor(l, address, deployment));
      const quotes = await ctx.sdk.fetchQuotes(ctx.rpc, sources);
      const slot = Number(await ctx.rpc.getSlot({ commitment: "confirmed" }).send());
      const now = Number(await ctx.rpc.getBlockTime(BigInt(slot)).send());
      const rows = [];
      for (const [i, { address, data: l }] of listings.entries()) {
        const price = quotes[i];
        const src = sources[i];
        const readFrom = src ? await quoteAddress(src) : null;
        const base = {
          listing: ctx.sdk.symbolOf(l),
          source: ctx.sdk.PRICE_SOURCE_NAMES[l.priceSource] ?? l.priceSource,
          attestedMark: ctx.sdk.isAttestedMark(l.priceSource),
          haircutBps: l.haircutBps,
          listingPda: address,
          /** The account the program reads: the cache PDA, or Pyth's receiver-owned account for source 4. */
          quoteAccount: readFrom,
        };
        if (!price) {
          rows.push({
            ...base,
            verdict: readFrom ? "no usable quote in that account" : "descriptor names no price account",
          });
          continue;
        }
        const f = ctx.sdk.quoteFreshness({ listing: l, price, slot, nowSecs: now });
        rows.push({
          ...base,
          readFrom: price.from,
          mark: Number(price.price) * 10 ** price.expo,
          quoteAgeSecs: f.quoteAgeSecs,
          quoteLimitSecs: l.maxPublishAgeSecs,
          postedAgeSlots: f.postedAgeSlots,
          postedLimitSlots: l.maxPriceAge,
          verdict: f.usable ? "lock / seize ACCEPTED" : `REFUSED (${!f.quoteFresh ? "QuoteStale" : "PriceStale"})`,
        });
      }
      return { slot, chainTime: new Date(now * 1000).toISOString(), listings: rows };
    },
  },
  {
    id: "pyth-mainnet",
    title: "Pyth's own accounts on mainnet, read from this browser",
    blurb: "Pyth's own PriceUpdateV2 accounts for the mark and the underlying, read from mainnet.",
    code: (ctx) => `import { createSolanaRpc, getProgramDerivedAddress, address } from "@solana/kit";
const mainnet = createSolanaRpc("${ctx.config.rpcUrl.includes("devnet") ? "https://solana-rpc.publicnode.com" : ctx.config.rpcUrl}");
const RECEIVER = "${PYTH_RECEIVER}";                       // PriceUpdateV2 accounts are owned by Pyth's receiver
const TSLAX = "${FEEDS["Crypto.TSLAX/USD"]}";
const TSLA  = "${FEEDS["Equity.US.TSLA/USD"]}";
// push-oracle PDA: ["shard u16 le", feed_id] under pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT; shards 0 and 1
const pda = async (shard, feed) => (await getProgramDerivedAddress({ programAddress: address("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"),
  seeds: [new Uint8Array([shard & 0xff, shard >> 8]), Uint8Array.from(feed.match(/../g), (h) => parseInt(h, 16))] }))[0];
// layout: disc(8) ‖ write_authority(32) ‖ verification_level(1|2) ‖ feed_id(32) ‖ price i64 ‖ conf u64 ‖ expo i32 ‖ publish_time i64
// (app/src/lib/pyth.ts decodePriceUpdate mirrors services/admin/src/price.rs. Source 0: the keeper posts the
//  freshest into the listing's cache; source 4: the program reads Pyth's receiver-owned account itself —
//  sdk.fetchQuote(rpc, listing) reads whichever the listing uses, and the chain enforces its publish_time)
for (const [name, feed] of [["TSLAX", TSLAX], ["TSLA", TSLA]]) {
  const accounts = await mainnet.getMultipleAccounts([await pda(0, feed), await pda(1, feed)], { encoding: "base64" }).send();
  console.log(name, accounts.value.map((a) => a && a.owner === RECEIVER ? "present" : "absent"));
}`,
    run: async (ctx) => {
      const read = async (name: string, feed: string) => {
        const p = await fetchFreshest(mainnetRpc, feed);
        if (!p) return { feed: name, present: false };
        return {
          feed: name,
          account: p.account,
          price: Number(p.price) * 10 ** p.expo,
          publishTime: new Date(p.publishTime * 1000).toISOString(),
          ageSecs: Math.max(0, Math.floor(Date.now() / 1000) - p.publishTime),
          verification: p.verification,
        };
      };
      const [wrapper, equity] = await Promise.all([
        read("Crypto.TSLAX/USD", FEEDS["Crypto.TSLAX/USD"]),
        read("Equity.US.TSLA/USD", FEEDS["Equity.US.TSLA/USD"]),
      ]);
      const basis =
        "price" in wrapper && "price" in equity && wrapper.price && equity.price
          ? basisBps(
              { price: BigInt(Math.round(wrapper.price * 1e8)), expo: -8 },
              { price: BigInt(Math.round(equity.price * 1e8)), expo: -8 },
            )
          : null;
      ctx.log(`session: ${nyseSession().label}`);
      return {
        wrapper,
        equity,
        wrapperBasisBp: basis,
        note: "the desk marks with the wrapper feed (24/7); the equity feed is shown beside it. A wrapper quote older than the listing's limit is refused on chain.",
      };
    },
  },
  {
    id: "marks",
    params: [
      {
        key: "label",
        kind: "choice",
        label: "listing",
        default: "prestocks:ANTHROPIC",
        // A mark label is `<source>:<SYMBOL>`, which is what the keeper hashes into the feed id. The
        // descriptor's own listings are offered so you can see what a `mock` label yields: nothing,
        // because a mock listing is priced by the walk, not by a posted mark.
        choices: (ctx) => markLabels(ctx.deployment),
        hint: "<source>:<symbol> — the label the keeper posts under",
      },
    ],
    title: "The attested mark: PreStocks, as posted on chain",
    blurb: 'A mark\'s feed id is sha256("<source>:<symbol>") — a label, never a Pyth id.',
    code: (ctx) => `${PRELUDE(ctx)}

// feed id = sha256("${ctx.p.str("label")}"): a label under which the keeper posts, never a Pyth id
const feedId    = await sdk.feedIdForLabel("${ctx.p.str("label")}");
const prestocks = await sdk.fetchPrice(rpc, feedId);
console.log("cache", await sdk.pda.priceCache(feedId));   // ["price", feed_id] under window_credit
console.log(Number(prestocks.price) * 10 ** prestocks.expo, "USD, fetched", new Date(Number(prestocks.publishTime) * 1000));

// what the keeper reads (server side — the API answers no CORS preflight); markPrice is the mark, tokenPrice the implied price:
//   curl -s https://prestocks.com/api/prestocks | jq '.[] | select(.contract_address=="Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw") | {markPrice, tokenPrice}'`,
    run: async (ctx) => {
      const one = async (label: string, api: string) => {
        const feedId = await ctx.sdk.feedIdForLabel(label);
        const price = await ctx.sdk.fetchPrice(ctx.rpc, feedId);
        const hex = Array.from(feedId, (b) => b.toString(16).padStart(2, "0")).join("");
        if (!price) return { label, feedId: hex, cache: "none" };
        return {
          label,
          feedId: hex,
          priceCache: await ctx.sdk.pda.priceCache(feedId),
          mark: Number(price.price) * 10 ** price.expo,
          fetchedAt: new Date(Number(price.publishTime) * 1000).toISOString(),
          ageSecs: Math.max(0, Math.floor(Date.now() / 1000) - Number(price.publishTime)),
          posts: price.posts,
          api,
        };
      };
      const label = ctx.p.str("label");
      return {
        mark: await one(label, label.startsWith("prestocks:") ? "https://prestocks.com/api/prestocks" : "—"),
        note: label.startsWith("mock:")
          ? "a mock listing is priced by the keeper's deterministic walk, not by a posted mark, so there is no cache under this label"
          : "an attested mark: publish_time is the keeper's fetch time; the on-chain limit for this listing is 48 h",
      };
    },
  },
  {
    id: "launch-status",
    title: "The lender agent's DBC pool, decoded from raw bytes",
    blurb: "Meteora's pool and config decoded from raw bytes, without Meteora's SDK.",
    code: (ctx) => `import * as sdk from "@thewindow/solana-sdk";
import { createSolanaRpc, address } from "@solana/kit";
const rpc = createSolanaRpc("${
      launchCluster === "mainnet-beta"
        ? "https://solana-rpc.publicnode.com"
        : ctx.config.cluster === "devnet"
          ? ctx.config.rpcUrl
          : "https://api.devnet.solana.com"
    }");   // the launch's cluster, not necessarily the desk's
// deployments/launch-${LAUNCH.cluster}.json: the pool services/launch created (config, base mint, quote, creator)
const { pool, config, progress } = await sdk.fetchDbc(rpc, address("${LAUNCH.pool}"));   // owner-checked against ${"dbcij3LW…"}
const dec = 10 ** ${LAUNCH.quote.decimals};                                                     // the quote's decimals (TSLAx: 8)
console.log("progress", progress, "raised", Number(pool.quoteReserve) / dec, "of", Number(config.migrationQuoteThreshold) / dec, "quote");
console.log("spot", sdk.dbcPrice(pool.sqrtPrice, 6, ${LAUNCH.quote.decimals}), "quote per ${LAUNCH.token.symbol}", "migrated", pool.isMigrated);
const fee = sdk.dbcFeeAt(config.baseFee, pool.activationPoint, Math.floor(Date.now() / 1000));  // the schedule, evaluated now
console.log("fee now", fee.bps, "bp · period", fee.period, "of", config.baseFee.numberOfPeriod, "· resting", fee.restingBps, "bp");
console.log("fees: creator", Number(pool.creatorQuoteFee) / dec, "partner", Number(pool.partnerQuoteFee) / dec, "total traded", Number(pool.totalTradingQuoteFee) / dec);
// the quote stock's USD price, the way the desk reads it (the "pyth-mainnet" recipe): fetchFreshest(mainnetRpc, FEEDS["Crypto.TSLAX/USD"])`,
    run: async (ctx) => {
      const { createSolanaRpc, address } = await import("@solana/kit");
      const rpc =
        launchCluster === "mainnet-beta"
          ? mainnetRpc
          : ctx.config.cluster === "devnet"
            ? ctx.rpc
            : createSolanaRpc("https://api.devnet.solana.com");
      const d = await ctx.sdk.fetchDbc(rpc, address(LAUNCH.pool));
      if (!d) return { pool: LAUNCH.pool, present: false };
      const dec = 10 ** LAUNCH.quote.decimals;
      return {
        cluster: LAUNCH.cluster,
        pool: LAUNCH.pool,
        baseMint: LAUNCH.baseMint,
        quoteMint: LAUNCH.quote.mint,
        progress: d.progress,
        raisedQuote: Number(d.pool.quoteReserve) / dec,
        thresholdQuote: Number(d.config.migrationQuoteThreshold) / dec,
        spotQuotePerToken: ctx.sdk.dbcPrice(d.pool.sqrtPrice, 6, LAUNCH.quote.decimals),
        activationPoint: new Date(Number(d.pool.activationPoint) * 1000).toISOString(),
        feeNow: (() => {
          const f = ctx.sdk.dbcFeeAt(d.config.baseFee, d.pool.activationPoint, Math.floor(Date.now() / 1000));
          return {
            bps: Number(f.bps.toFixed(2)),
            period: f.period,
            of: d.config.baseFee.numberOfPeriod,
            restingBps: Number(f.restingBps.toFixed(2)),
          };
        })(),
        hasSwap: d.pool.hasSwap,
        feeClaimer: d.config.feeClaimer,
        isMigrated: d.pool.isMigrated,
        fees: {
          creator: Number(d.pool.creatorQuoteFee) / dec,
          partner: Number(d.pool.partnerQuoteFee) / dec,
          totalTraded: Number(d.pool.totalTradingQuoteFee) / dec,
        },
        note: "devnet is a rehearsal on a twin quote mint; the numbers are the same code path as the Market card.",
      };
    },
  },
  {
    id: "solvency",
    title: "What a loan costs in collateral on each listing",
    params: [
      {
        key: "loan",
        kind: "usdc",
        label: "loan",
        default: 1000,
        hint: "USDC — the notional the pledge is computed for",
      },
    ],
    blurb: "The scalars the program forms E_delta with, and the pledge it asks for.",
    code: (ctx) => `${PRELUDE(ctx)}

const LOAN = ${ctx.p.big("loan")}n;${" ".repeat(Math.max(1, 34 - ctx.p.big("loan").toString().length))}// ${ctx.p.int("loan").toLocaleString("en-US")} USDC in micro-USDC
const descriptor = await (await fetch("${ctx.config.adminUrl || "https://<admin>"}/deployment")).json();
for (const { address, data: l } of await sdk.fetchListings(rpc)) {
  const price = await sdk.fetchQuote(rpc, {                          // the cache PDA, or Pyth's account for source 4
    feedId: new Uint8Array(l.feedId), priceSource: l.priceSource,     // (price_account from deployments/devnet.json)
    priceAccount: descriptor.listings.find((d) => d.listing === address)?.price_account ?? null,
  });
  if (!price) continue;
  const mult  = await sdk.fetchMultiplier(rpc, l.mockMint);        // ScaledUiAmount on the mock mint
  const s = sdk.solvencyScalars(sdk.priceCents(price.price, price.expo), sdk.multiplierScaled(mult.multiplier), l.haircutBps);
  console.log(sdk.symbolOf(l), "k_c", s.kC, "k_l", s.kL, "required", sdk.collateralRequired(LOAN, s), "pledge", sdk.collateralPledge(LOAN, s), "milli-shares");
}`,
    run: async (ctx) => {
      const LOAN = ctx.p.big("loan");
      const out = [];
      const deployment = ctx.deployment ?? (await fetchDeployment());
      for (const { address, data: l } of await ctx.sdk.fetchListings(ctx.rpc)) {
        const price = await ctx.sdk.fetchQuote(ctx.rpc, quoteSourceFor(l, address, deployment));
        if (!price) {
          out.push({ listing: ctx.sdk.symbolOf(l), skipped: "no usable quote where the program reads it" });
          continue;
        }
        const mult = await ctx.sdk.fetchMultiplier(ctx.rpc, l.mockMint);
        const s = ctx.sdk.solvencyScalars(
          ctx.sdk.priceCents(price.price, price.expo),
          ctx.sdk.multiplierScaled(mult.multiplier),
          l.haircutBps,
        );
        const required = ctx.sdk.collateralRequired(LOAN, s);
        const pledge = ctx.sdk.collateralPledge(LOAN, s);
        out.push({
          listing: ctx.sdk.symbolOf(l),
          markUsd: Number(price.price) * 10 ** price.expo,
          multiplier: mult.multiplier,
          haircut: `${Number(l.haircutBps) / 100}%`,
          kC: s.kC,
          kL: s.kL,
          requiredShares: Number(required) / 10 ** l.decimals,
          pledgedShares: Number(pledge) / 10 ** l.decimals,
        });
      }
      return { loanUsdc: ctx.p.int("loan"), listings: out };
    },
  },
  {
    id: "latest-print",
    params: [
      {
        key: "epoch",
        kind: "text",
        label: "epoch",
        default: "",
        placeholder: "latest",
        example: "100",
        hint: "blank reads whatever printed last",
      },
    ],
    title: "The last print and its curve",
    blurb: "Rebuild the depth curve from the proven sums and clear it locally.",
    code: (ctx) => `${PRELUDE(ctx)}

const oracle = await sdk.fetchOracle(rpc);
const epoch  = ${chosenEpoch(ctx, "epoch") === null ? "oracle.lastPrintEpoch" : `${chosenEpoch(ctx, "epoch")}n`};
const print  = await sdk.fetchPrint(rpc, epoch);
const { curve, clearing } = sdk.depthFromPrint(print);   // clearing === sdk.clear(curve)
console.log(sdk.formatRate(clearing.rStar), clearing.matched, sdk.cumulative(curve));`,
    run: async (ctx) => {
      const oracle = await ctx.sdk.fetchOracle(ctx.rpc);
      const asked = chosenEpoch(ctx, "epoch");
      if (asked === null && !oracle?.hasPrinted) throw new Error("nothing printed yet, and no epoch was given");
      const index = asked ?? (oracle as { lastPrintEpoch: bigint }).lastPrintEpoch;
      const print = await ctx.sdk.fetchPrint(ctx.rpc, index);
      if (!print) throw new Error(`no print account for epoch ${index}`);
      const { curve, clearing } = ctx.sdk.depthFromPrint(print);
      const local = ctx.sdk.clear(curve);
      return {
        epoch: index,
        onChain: { rStarTick: print.rStarTick, matchedVolume: print.matchedVolume, status: print.status },
        recomputed: clearing,
        agrees: local?.rStar === print.rStarTick && local?.matched === print.matchedVolume,
        rate: clearing ? ctx.sdk.formatRate(clearing.rStar) : null,
        curve: ctx.sdk.cumulative(curve).filter((p) => p.supply > 0n || p.demand > 0n),
      };
    },
  },
  {
    id: "verify",
    params: [
      {
        key: "epoch",
        kind: "text",
        label: "epoch",
        default: "",
        placeholder: "latest",
        example: "100",
        hint: "blank re-derives the last print",
      },
    ],
    title: "Re-verify a print in this tab",
    blurb: "Check every zero-ciphertext proof with the wasm verifier, here.",
    code: (ctx) => `${PRELUDE(ctx)}

const oracle = await sdk.fetchOracle(rpc);
const verdict = await sdk.verifyPrint(rpc, ${chosenEpoch(ctx, "epoch") === null ? "oracle.lastPrintEpoch" : `${chosenEpoch(ctx, "epoch")}n`}, {
  onStage: (stage, d) => console.log(stage, d),   // accounts → signatures → transactions → proofs → verify
});
console.log(verdict.ok, verdict.proven, "/", verdict.nonzero, verdict.r_star_recomputed, verdict.failures);`,
    run: async (ctx) => {
      const oracle = await ctx.sdk.fetchOracle(ctx.rpc);
      const asked = chosenEpoch(ctx, "epoch");
      if (asked === null && !oracle?.hasPrinted) throw new Error("nothing printed yet, and no epoch was given");
      const index = asked ?? (oracle as { lastPrintEpoch: bigint }).lastPrintEpoch;
      const t0 = performance.now();
      const verdict = await ctx.sdk.verifyPrint(ctx.rpc, index, {
        onStage: (stage, d) =>
          ctx.log(
            `${stage}${d?.count !== undefined ? ` ${d.count}${d.total !== undefined ? `/${d.total}` : ""}` : ""} · ${Math.round(performance.now() - t0)} ms`,
          ),
      });
      return { epoch: index, ...verdict, ms: Math.round(performance.now() - t0) };
    },
  },
  {
    id: "me",
    params: [
      {
        key: "wallet",
        kind: "text",
        label: "wallet",
        default: "",
        placeholder: "yours",
        example: "51gsw5oEYXhcUVPQWW4c5Y5c1HWABtgzNMNdWCDLr62z",
        hint: "any address — blank uses the one connected here",
      },
    ],
    title: "My membership, bids and loans",
    blurb: "One wallet: its member record, sealed bids, loans on both sides.",
    needs: "wallet",
    code: (ctx) => `${PRELUDE(ctx)}

const wallet = address("${askedWallet(ctx, "wallet") ?? "<your wallet>"}");
const member = await sdk.fetchMember(rpc, wallet);       // { elgamalPubkey, joinedEpoch, active } or null
const bids   = await sdk.fetchBidsFor(rpc, wallet);      // sealed: ciphertext only
const loans  = await sdk.fetchLoansFor(rpc, wallet);     // { borrowed, lent }, sizes as ciphertexts
console.log(member, bids.length, loans.borrowed.map((l) => sdk.LOAN_STATUS_NAMES[l.data.status]), loans.lent.length);`,
    run: async (ctx) => {
      const who = askedWallet(ctx, "wallet");
      if (!who) throw new Error("connect a wallet, take a burner, or type an address");
      const [member, bids, loans] = await Promise.all([
        ctx.sdk.fetchMember(ctx.rpc, who),
        ctx.sdk.fetchBidsFor(ctx.rpc, who),
        ctx.sdk.fetchLoansFor(ctx.rpc, who),
      ]);
      return {
        wallet: ctx.wallet,
        member,
        bids: bids.map((b) => ({
          address: b.address,
          epoch: b.data.epoch,
          side: b.data.side,
          tick: b.data.tick,
          ciphertextBytes: b.data.ciphertext.length,
        })),
        loans: {
          borrowed: loans.borrowed.map((l) => ({
            address: l.address,
            status: ctx.sdk.LOAN_STATUS_NAMES[l.data.status],
            tick: l.data.tick,
          })),
          lent: loans.lent.map((l) => ({
            address: l.address,
            status: ctx.sdk.LOAN_STATUS_NAMES[l.data.status],
            tick: l.data.tick,
          })),
        },
      };
    },
  },
  {
    id: "bid-dry-run",
    title: "Build a bid plan (dry run)",
    blurb: "Real proofs and the three transactions laid out — nothing sent.",
    needs: "keys",
    params: [
      {
        key: "side",
        kind: "choice",
        label: "side",
        default: "1",
        choices: () => [
          { value: "1", label: "borrow USDC" },
          { value: "0", label: "lend USDC" },
        ],
      },
      { key: "tick", kind: "int", label: "tick", default: 8, min: 0, max: 36, hint: "0–36 · 100 bp + 25 bp per tick" },
      { key: "size", kind: "usdc", label: "size", default: 1000, hint: "USDC, encrypted before it is sent" },
    ],
    code: (ctx) => `${PRELUDE(ctx)}

const cfg   = await sdk.fetchAuctionConfig(rpc);
const epoch = await sdk.fetchEpoch(rpc, cfg.currentEpoch);   // carries the auditor key in force
const plan  = await sdk.buildBidPlan({
  member: signer,                         // your wallet (TransactionSigner)
  signature: memberSignature,             // wallet signature over sdk.memberSigningMessage() — never logged
  auditorPubkey: new Uint8Array(epoch.auditorPubkey),
  epoch: cfg.currentEpoch,
  side: ${ctx.p.int("side")},                                // 1 = borrow USDC, 0 = lend
  tick: ${ctx.p.int("tick")},                                // sdk.formatRate(${ctx.p.int("tick")}) = "${ctx.sdk.formatRate(ctx.p.int("tick"))}", sdk.tickToBps(${ctx.p.int("tick")}) = ${ctx.sdk.tickToBps(ctx.p.int("tick"))}
  sizeMicroUsdc: ${ctx.p.big("size")}n,          // ${ctx.p.int("size").toLocaleString("en-US")} USDC
  sMin: cfg.sMin,
  rent: (space) => rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
});
// plan.txs: create range ctx → verify range → verify validity + submit_bid
// await sdk.sendPlan(rpc, plan, signer);   ← this is what the Desk does`,
    run: async (ctx) => {
      if (!ctx.wallet || !ctx.memberSignature) throw new Error("derive your keys on the Desk first");
      const { createNoopSigner } = await import("@solana/kit");
      const cfg = await ctx.sdk.fetchAuctionConfig(ctx.rpc);
      if (!cfg) throw new Error("auction config missing");
      const epoch = await ctx.sdk.fetchEpoch(ctx.rpc, cfg.currentEpoch);
      if (!epoch) throw new Error("epoch account missing");
      const t0 = performance.now();
      const plan = await ctx.sdk.buildBidPlan({
        member: createNoopSigner(ctx.wallet),
        signature: ctx.memberSignature,
        auditorPubkey: new Uint8Array(epoch.auditorPubkey),
        epoch: cfg.currentEpoch,
        side: ctx.p.int("side") === 1 ? 1 : 0,
        tick: ctx.p.int("tick"),
        sizeMicroUsdc: ctx.p.big("size"),
        sMin: cfg.sMin,
        rent: ctx.rentFor,
      });
      return {
        epoch: cfg.currentEpoch,
        side: ctx.p.int("side") === 1 ? "borrow" : "lend",
        rate: ctx.sdk.formatRate(ctx.p.int("tick")),
        bps: ctx.sdk.tickToBps(ctx.p.int("tick")),
        proofsMs: Math.round(performance.now() - t0),
        ciphertextBytes: plan.ciphertext.length,
        txs: plan.txs.map((t) => ({
          label: t.label,
          instructions: t.instructions.length,
          programs: Array.from(new Set(t.instructions.map((i) => i.programAddress))),
          extraSigners: t.extraSigners.map((s) => s.address),
        })),
        note: "nothing was sent; the opening stays in this tab",
      };
    },
  },
  {
    id: "subscribe",
    title: "Subscribe to the programs' events",
    blurb: "Follow the three programs' logs and decode the Anchor events.",
    params: [
      {
        key: "seconds",
        kind: "int",
        label: "listen for",
        default: 60,
        min: 5,
        max: 300,
        hint: "seconds — a window is minutes long, so a short listen may see nothing",
      },
    ],
    code: (ctx) => `import { createSolanaRpcSubscriptions, getBase64Encoder } from "@solana/kit";
import * as sdk from "@thewindow/solana-sdk";
const subs = createSolanaRpcSubscriptions("${ctx.config.wsUrl}");
const logs = await subs
  .logsNotifications({ mentions: [sdk.PROGRAMS.oracle] }, { commitment: "confirmed" })
  .subscribe({ abortSignal: AbortSignal.timeout(${ctx.p.int("seconds")}_000) });
for await (const n of logs) {
  for (const line of n.value.logs) {
    if (!line.startsWith("Program data: ")) continue;             // Anchor emit! → base64(disc ‖ borsh)
    const bytes = getBase64Encoder().encode(line.slice(14));
    try { console.log(n.value.signature, sdk.oracle.parsePrintedEvent(bytes)); } catch {}   // or parseNoTradeEvent, …
  }
}`,
    run: (ctx) =>
      new Promise((resolve) => {
        const events: unknown[] = [];
        const ctrl = new AbortController();
        const done = () => {
          ctrl.abort();
          resolve({
            seconds: ctx.p.int("seconds"),
            events,
            note:
              events.length === 0
                ? `no event in ${ctx.p.int("seconds")} s — the market may be paused, or nothing happened in that window`
                : undefined,
          });
        };
        const timer = setTimeout(done, ctx.p.int("seconds") * 1_000);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          done();
        });
        ctx.log(`listening on ${ctx.config.wsUrl} for ${ctx.p.int("seconds")} s (oracle + auction) …`);
        void startLive({
          wsUrl: ctx.config.wsUrl,
          programs: ["oracle", "auction", "credit"],
          signal: ctrl.signal,
          onInvalidate: () => {},
          onStatus: (s) => ctx.log(s.connected ? "connected" : `disconnected: ${s.error ?? ""}`),
          onEvent: (e) => {
            events.push({ program: e.program, name: e.name, signature: e.signature, data: e.data });
            ctx.log(`${e.program}.${e.name} ${e.signature.slice(0, 8)}…`);
          },
        });
      }),
  },
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // The write track. Everything below sends transactions, and every one of them goes through the
  // Desk's own flows (`features/desk/useDesk.ts`) rather than a second implementation: the plan is
  // built by the same builder, sent by the same `sendPlan`, and traced into the same console. A bid
  // sealed here is indistinguishable on chain from one sealed on the Desk, which is the point —
  // /build is meant to show you how to drive the desk, not a demonstration of driving it.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "derive-keys",
    title: "Derive your confidential keys",
    blurb: "Two wallet signatures; their ElGamal keys never leave this tab.",
    needs: "wallet",
    writes: true,
    code: (ctx) => `${PRELUDE(ctx)}

// The two messages are fixed strings the browser, the agents and the CLI all agree on.
const memberSignature = await signMessage({ message: sdk.memberSigningMessage() });
const tokenSignature  = await signMessage({ message: sdk.tokenAccountSigningMessage(addressBytes(cstockAta)) });
const w = await sdk.proofs();                                  // the wasm verifier + key derivation
const elgamalPubkey = w.elgamal_pubkey_from_signature(memberSignature);
// Nothing is sent: a signature over a message is not a transaction. The keys stay in this tab.`,
    run: async (ctx) => {
      if (!ctx.desk) throw new Error("connect a wallet or take a burner first");
      await ctx.desk.deriveKeys.mutateAsync();
      return {
        derived: true,
        listing: ctx.desk.listing?.symbol ?? null,
        note: "two signatures, no transaction — the ElGamal keys exist only in this tab",
      };
    },
  },
  {
    id: "join",
    title: "Join the desk through the faucet",
    blurb: "The one off-chain call in the flow, and it is rate limited.",
    needs: "keys",
    writes: true,
    code: (ctx) => `${PRELUDE(ctx)}

// The faucet needs your ElGamal pubkey, which comes from the member signature (see "derive-keys").
const res = await fetch("${ctx.config.adminUrl || "https://<admin>"}/join", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet: "${ctx.wallet ?? "<your wallet>"}",
    elgamal_pubkey_hex: bytesToHex(elgamalPubkey),
    mock_account: await sdk.pda.ata("${ctx.wallet ?? "<your wallet>"}", listings[0].mockMint),
  }),
});
// → { ok, signature, already_member }   · 429 with retry_after_secs when the hourly cap is spent
//   · 503 when the administrator's balance is below its floor`,
    run: async (ctx) => {
      if (!ctx.desk) throw new Error("connect a wallet or take a burner first");
      if (!ctx.deployment?.faucet) throw new Error("no admin service answered, so the faucet cannot admit this wallet");
      const r = await ctx.desk.join.mutateAsync();
      return { ...r, note: r.alreadyMember ? "already a member — nothing minted or sent" : "member added and funded" };
    },
  },
  {
    id: "onboard",
    title: "Create and configure the confidential account",
    blurb: "Create this listing's cSTOCK-W account, then configure it with a proof.",
    needs: "keys",
    writes: true,
    code: (ctx) => `${PRELUDE(ctx)}

const plan = await sdk.buildOnboardPlan({
  member: signer,
  mockMint: listing.mockMint,
  cstockMint: listing.cstockMint,
  tokenSignature,                      // never logged
  mockAtaExists: true, cstockAtaExists: false, cstockConfigured: false,
});
await sdk.sendPlan(rpc, plan, signer);   // create ATA → reallocate + configure with a pubkey-validity proof`,
    run: async (ctx) => {
      if (!ctx.desk) throw new Error("connect a wallet or take a burner first");
      if (ctx.desk.accounts.data?.cstock.configured)
        return { alreadyConfigured: true, note: "this listing's confidential account is already set up" };
      const sigs = await ctx.desk.onboard.mutateAsync();
      return { signatures: sigs, transactions: sigs.length };
    },
  },
  {
    id: "wrap",
    title: "Wrap shares into cSTOCK-W",
    blurb: "Public shares in, confidential balance out — encrypted before it is sent.",
    needs: "keys",
    writes: true,
    params: [
      {
        key: "shares",
        kind: "int",
        label: "shares",
        default: DEFAULT_WRAP_SHARES,
        min: 1,
        max: 10_000,
        hint: "the faucet grants 10,000 shares; asking for more fails inside Token-2022",
      },
    ],
    code: (ctx) => `${PRELUDE(ctx)}

const w = await sdk.proofs();
const amount = ${shares(ctx)}n;                                       // ${ctx.p.int("shares").toLocaleString("en-US")} shares, at the mint's 3 decimals
const plan = await sdk.buildWrapPlan({
  member: signer,
  mockMint: listing.mockMint, cstockMint: listing.cstockMint,
  memberMock: mockAta, memberCstock: cstockAta,
  amount,
  pendingCreditCounter: view.pendingBalanceCreditCounter,
  // available + pending + amount, encrypted to your own key — the chain stores the ciphertext
  newDecryptableBalance: w.encrypt_balance(tokenSignature, String(available + pending + amount)),
});
await sdk.sendPlan(rpc, plan, signer);`,
    run: async (ctx) => {
      if (!ctx.desk) throw new Error("connect a wallet or take a burner first");
      const before = ctx.desk.balances.data;
      const sigs = await ctx.desk.wrap.mutateAsync(shares(ctx));
      return {
        wrappedShares: ctx.p.int("shares"),
        wrappedBaseUnits: shares(ctx),
        signatures: sigs,
        balanceBefore: before ? { available: before.available, pending: before.pending } : null,
        note: "the new balance lands as pending until apply-pending folds it in",
      };
    },
  },
  {
    id: "apply-pending",
    title: "Fold the pending balance in",
    blurb: "A confidential credit arrives pending; this folds it in.",
    needs: "keys",
    writes: true,
    code: (ctx) => `${PRELUDE(ctx)}

const w = await sdk.proofs();
const ix = sdk.applyPendingBalanceInstruction(
  cstockAta, owner, view.pendingBalanceCreditCounter,
  w.encrypt_balance(tokenSignature, String(available + pending)),
);
await sdk.sendPlan(rpc, { txs: [{ label: "apply pending balance", instructions: [ix], extraSigners: [] }] }, signer);`,
    run: async (ctx) => {
      if (!ctx.desk) throw new Error("connect a wallet or take a burner first");
      // `useDesk` guards this with a bare "not ready"; name the missing piece instead.
      if (!ctx.desk.accounts.data?.cstock.configured)
        throw new Error('no confidential account for this listing yet — run "onboard" first');
      const before = ctx.desk.balances.data;
      if (!before) throw new Error("the confidential balance has not been decrypted yet — give it a moment and retry");
      if (before.pending === 0n)
        return { nothingPending: true, available: before.available, note: "nothing to fold in; wrap something first" };
      const sigs = await ctx.desk.applyPending.mutateAsync();
      return { signatures: sigs, foldedIn: before?.pending ?? null };
    },
  },
  {
    id: "bid",
    title: "Seal a bid and send it",
    blurb: "The real thing: sealed, proved in range, submitted. Three transactions.",
    needs: "keys",
    writes: true,
    params: [
      {
        key: "side",
        kind: "choice",
        label: "side",
        default: "1",
        choices: () => [
          { value: "1", label: "borrow USDC" },
          { value: "0", label: "lend USDC" },
        ],
      },
      { key: "tick", kind: "int", label: "tick", default: 12, min: 0, max: 36, hint: "100 bp + 25 bp per tick" },
      { key: "size", kind: "usdc", label: "size", default: 500, hint: "USDC — encrypted before it is sent" },
    ],
    code: (ctx) => `${PRELUDE(ctx)}

const cfg   = await sdk.fetchAuctionConfig(rpc);
const epoch = await sdk.fetchEpoch(rpc, cfg.currentEpoch);     // carries the auditor key in force
const plan  = await sdk.buildBidPlan({
  member: signer,
  signature: memberSignature,                                  // never logged
  auditorPubkey: new Uint8Array(epoch.auditorPubkey),
  epoch: cfg.currentEpoch,
  side: ${ctx.p.int("side")},                                                     // 1 = borrow, 0 = lend
  tick: ${ctx.p.int("tick")},                                                    // sdk.formatRate(${ctx.p.int("tick")}) = "${ctx.sdk.formatRate(ctx.p.int("tick"))}"
  sizeMicroUsdc: ${ctx.p.big("size")}n,                                  // ${ctx.p.int("size").toLocaleString("en-US")} USDC
  sMin: cfg.sMin,
  rent: (space) => rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
});
await sdk.sendPlan(rpc, plan, signer);   // create range ctx → verify range → verify validity + submit_bid`,
    run: async (ctx) => {
      if (!ctx.desk) throw new Error("connect a wallet or take a burner first");
      if (!ctx.desk.cfg.data?.hasOpenEpoch)
        throw new Error("no window is open — a bid can only be sealed while one is");
      const side = ctx.p.int("side") === 1 ? 1 : 0;
      const sigs = await ctx.desk.bid.mutateAsync({
        side,
        tick: ctx.p.int("tick"),
        sizeMicroUsdc: ctx.p.big("size"),
      });
      return {
        epoch: ctx.desk.cfg.data.currentEpoch,
        side: side === 1 ? "borrow" : "lend",
        tick: ctx.p.int("tick"),
        rate: ctx.sdk.formatRate(ctx.p.int("tick")),
        sizeUsdc: ctx.p.int("size"),
        signatures: sigs,
        note: "the size is a ciphertext on chain; a match becomes a loan after the print",
      };
    },
  },
  {
    id: "close-bid",
    title: "Reclaim the rent from an old bid",
    blurb: "Permissionless, and the rent goes back to the bid's own member.",
    needs: "wallet",
    writes: true,
    code: (ctx) => `${PRELUDE(ctx)}

const cfg  = await sdk.fetchAuctionConfig(rpc);
const bids = await sdk.fetchBidsFor(rpc, wallet);                  // one account per (epoch, side, tick)
const old  = bids.filter((b) => b.data.epoch < cfg.currentEpoch);  // a live window's bid cannot be closed
const ix = await sdk.auction.getCloseBidInstructionAsync({
  anyone: signer,                                                  // whoever pays the fee
  epoch: await sdk.pda.epoch(old[0].data.epoch),
  bid: old[0].address,
  member: old[0].data.member,                                      // the rent goes here, not to the signer
});
await sdk.sendPlan(rpc, { txs: [{ label: "close bid", instructions: [ix], extraSigners: [] }] }, signer);`,
    run: async (ctx) => {
      if (!ctx.desk || !ctx.wallet) throw new Error("connect a wallet or take a burner first");
      const cfg = await ctx.sdk.fetchAuctionConfig(ctx.rpc);
      if (!cfg) throw new Error("auction config missing");
      const bids = await ctx.sdk.fetchBidsFor(ctx.rpc, ctx.wallet);
      const closable = bids
        .filter((b) => b.data.epoch < cfg.currentEpoch)
        .sort((a, b) => Number(a.data.epoch - b.data.epoch));
      const first = closable[0];
      if (!first)
        return {
          closed: null,
          sealedBids: bids.length,
          note:
            bids.length === 0
              ? "this wallet holds no bid accounts — seal one first"
              : "every bid this wallet holds belongs to the window that is still open; they can be closed after it prints",
        };
      const sigs = await ctx.desk.closeBid.mutateAsync({
        bid: first.address,
        epoch: first.data.epoch,
        member: first.data.member,
      });
      return {
        closed: { bid: first.address, epoch: first.data.epoch, side: first.data.side, tick: first.data.tick },
        rentRefundedTo: first.data.member,
        remaining: closable.length - 1,
        signatures: sigs,
      };
    },
  },
  {
    id: "mark-stale",
    title: "Record that a print is overdue",
    blurb: "Permissionless — and the program refuses it unless the keeper really is late.",
    needs: "wallet",
    writes: true,
    params: [
      {
        key: "epoch",
        kind: "text",
        label: "epoch",
        default: "",
        placeholder: "the last closed one",
        example: "100",
        hint: "an *open* epoch can never be stale — the program requires it closed",
      },
    ],
    code: (ctx) => `${PRELUDE(ctx)}

const cfg    = await sdk.fetchAuctionConfig(rpc);
const epoch  = await sdk.fetchEpoch(rpc, cfg.currentEpoch - 1n);   // an open epoch can never be stale
const oracle = await sdk.fetchOracle(rpc);
// The program's own condition, so a refusal can be explained before it is attempted:
const overdue = epoch.closeSlot > 0n && (await rpc.getSlot().send()) >= epoch.closeSlot + oracle.staleAfterSlots;
const ix = await sdk.oracle.getMarkStaleInstructionAsync({
  anyone: signer,
  epoch: await sdk.pda.epoch(${chosenEpoch(ctx, "epoch") === null ? "cfg.currentEpoch - 1n" : `${chosenEpoch(ctx, "epoch")}n`}),
  epochIndex: ${chosenEpoch(ctx, "epoch") === null ? "cfg.currentEpoch - 1n" : `${chosenEpoch(ctx, "epoch")}n`},
});
await sdk.sendPlan(rpc, { txs: [{ label: "mark stale", instructions: [ix], extraSigners: [] }] }, signer);
// The program refuses unless the print is past its deadline — an on-chain check, not a convention.`,
    run: async (ctx) => {
      if (!ctx.desk) throw new Error("connect a wallet or take a burner first");
      const asked = chosenEpoch(ctx, "epoch");
      const cfg = await ctx.sdk.fetchAuctionConfig(ctx.rpc);
      if (!cfg) throw new Error("auction config missing");
      // The open epoch is never a candidate: the program requires `EpochStatus::Closed`. So the
      // default is the one before it, the most recent that could possibly be overdue.
      const index = asked ?? (cfg.currentEpoch > 0n ? cfg.currentEpoch - 1n : 0n);
      const [epoch, oracle, slot] = await Promise.all([
        ctx.sdk.fetchEpoch(ctx.rpc, index),
        ctx.sdk.fetchOracle(ctx.rpc),
        ctx.rpc.getSlot({ commitment: "confirmed" }).send(),
      ]);
      if (!epoch) throw new Error(`no epoch account for ${index}`);
      if (!oracle) throw new Error("oracle state missing");
      // Both of the program's conditions, checked here, so a refusal is a sentence rather than a
      // simulation failure. A punctual keeper is the normal case, and saying so is the honest result.
      if (epoch.closeSlot === 0n)
        return { epoch: index, sent: false, reason: "this epoch is still open; only a closed one can be overdue" };
      const deadline = epoch.closeSlot + oracle.staleAfterSlots;
      const now = Number(slot);
      if (now < Number(deadline))
        return {
          epoch: index,
          sent: false,
          closeSlot: epoch.closeSlot,
          staleAfterSlots: oracle.staleAfterSlots,
          deadlineSlot: deadline,
          slotsRemaining: Number(deadline) - now,
          reason: "the keeper is inside its deadline, so the program would refuse this — nothing was sent",
        };
      const sigs = await ctx.desk.markStale.mutateAsync(index);
      return {
        epoch: index,
        sent: true,
        deadlineSlot: deadline,
        signatures: sigs,
        note: "recorded on chain: this epoch's print missed its deadline",
      };
    },
  },
];
