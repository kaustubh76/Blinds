/**
 * Live recipes: each one is a snippet a developer can copy *and* the same call run in this tab
 * against the configured RPC. `code` and `run` sit side by side on purpose — a test checks that
 * every `sdk.X` the run calls is named in the snippet, so the text never drifts from what executes.
 */
import type { Address } from "@solana/kit";
import type * as SDK from "@thewindow/solana-sdk";
import type { Resolved } from "../../config";
import type { DeploymentView } from "../../lib/chain";
import { startLive } from "../../lib/live";
import { basisBps, FEEDS, fetchFreshest, mainnetRpc, nyseSession, PYTH_RECEIVER } from "../../lib/pyth";

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
}

export interface Recipe {
  id: string;
  title: string;
  blurb: string;
  needs?: "wallet" | "keys";
  code: (ctx: RecipeCtx) => string;
  run: (ctx: RecipeCtx) => Promise<unknown>;
}

const PRELUDE = (ctx: RecipeCtx) =>
  `import * as sdk from "@thewindow/solana-sdk";
import { createSolanaRpc } from "@solana/kit";
const rpc = createSolanaRpc("${ctx.config.rpcUrl}");`;

export const RECIPES: Recipe[] = [
  {
    id: "config",
    title: "Read the market",
    blurb: "The three config accounts and the PDAs everything hangs off. No wallet, no service — just the RPC.",
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
    blurb:
      "Every Listing account, its PriceCache and the two freshness rules lock_collateral and seize apply — the same call the operator's `pnpm schedule` makes.",
    code: (ctx) => `${PRELUDE(ctx)}

const listings = await sdk.fetchListings(rpc);                       // every Listing account, sorted by symbol
const prices   = await sdk.fetchPrices(rpc, listings.map((l) => new Uint8Array(l.data.feedId)));   // one RPC call
const slot     = Number(await rpc.getSlot({ commitment: "confirmed" }).send());
const now      = Number(await rpc.getBlockTime(BigInt(slot)).send());
for (const [i, { address, data: l }] of listings.entries()) {
  const price = prices[i];
  if (!price) { console.log(sdk.symbolOf(l), "no cache yet"); continue; }
  const f = sdk.quoteFreshness({ listing: l, price, slot, nowSecs: now });
  console.log(sdk.symbolOf(l), sdk.PRICE_SOURCE_NAMES[l.priceSource], sdk.isAttestedMark(l.priceSource) ? "(attested mark)" : "",
    "mark", Number(price.price) * 10 ** price.expo, "haircut", Number(l.haircutBps) / 100 + "%",
    "quote", f.quoteAgeSecs + "s old (limit " + l.maxPublishAgeSecs + ")", "posted", f.postedAgeSlots + " slots ago (limit " + l.maxPriceAge + ")",
    f.usable ? "→ lock/seize ACCEPTED" : "→ REFUSED", "listing", address, "cache", await sdk.pda.priceCache(new Uint8Array(l.feedId)));
}`,
    run: async (ctx) => {
      const listings = await ctx.sdk.fetchListings(ctx.rpc);
      const prices = await ctx.sdk.fetchPrices(
        ctx.rpc,
        listings.map((l) => new Uint8Array(l.data.feedId)),
      );
      const slot = Number(await ctx.rpc.getSlot({ commitment: "confirmed" }).send());
      const now = Number(await ctx.rpc.getBlockTime(BigInt(slot)).send());
      const rows = [];
      for (const [i, { address, data: l }] of listings.entries()) {
        const price = prices[i];
        const cache = await ctx.sdk.pda.priceCache(new Uint8Array(l.feedId));
        const base = {
          listing: ctx.sdk.symbolOf(l),
          source: ctx.sdk.PRICE_SOURCE_NAMES[l.priceSource] ?? l.priceSource,
          attestedMark: ctx.sdk.isAttestedMark(l.priceSource),
          haircutBps: l.haircutBps,
          listingPda: address,
          priceCachePda: cache,
        };
        if (!price) {
          rows.push({ ...base, verdict: "no cache yet" });
          continue;
        }
        const f = ctx.sdk.quoteFreshness({ listing: l, price, slot, nowSecs: now });
        rows.push({
          ...base,
          mark: Number(price.price) * 10 ** price.expo,
          posts: price.posts,
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
    blurb:
      "The push-oracle PriceUpdateV2 accounts for Crypto.TSLAX/USD (the desk's mark) and Equity.US.TSLA/USD (the underlying): owner check, feed id, publish_time, verification level, and the wrapper basis. No key, no service.",
    code: (ctx) => `import { createSolanaRpc, getProgramDerivedAddress, address } from "@solana/kit";
const mainnet = createSolanaRpc("${ctx.config.rpcUrl.includes("devnet") ? "https://solana-rpc.publicnode.com" : ctx.config.rpcUrl}");
const RECEIVER = "${PYTH_RECEIVER}";                       // PriceUpdateV2 accounts are owned by Pyth's receiver
const TSLAX = "${FEEDS["Crypto.TSLAX/USD"]}";
const TSLA  = "${FEEDS["Equity.US.TSLA/USD"]}";
// push-oracle PDA: ["shard u16 le", feed_id] under pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT; shards 0 and 1
const pda = async (shard, feed) => (await getProgramDerivedAddress({ programAddress: address("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"),
  seeds: [new Uint8Array([shard & 0xff, shard >> 8]), Uint8Array.from(feed.match(/../g), (h) => parseInt(h, 16))] }))[0];
// layout: disc(8) ‖ write_authority(32) ‖ verification_level(1|2) ‖ feed_id(32) ‖ price i64 ‖ conf u64 ‖ expo i32 ‖ publish_time i64
// (app/src/lib/pyth.ts decodePriceUpdate mirrors services/admin/src/price.rs; the keeper posts the freshest
//  into the listing's cache — sdk.fetchPrice(rpc, feedId) — and the chain enforces its publish_time)
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
    title: "The attested marks: Tessera and PreStocks, as posted on chain",
    blurb:
      "A mark listing's feed id is sha256(\"<source>:<symbol>\") — a label, never a Pyth id — and its publish_time is the keeper's fetch time. The public APIs send no CORS headers, so a browser reads the on-chain cache; the curl is what the keeper does.",
    code: (ctx) => `${PRELUDE(ctx)}

// feed id = sha256("tessera:T-OpenAI") / sha256("prestocks:ANTHROPIC"): a label under which the keeper posts
const tessera   = await sdk.fetchPrice(rpc, await sdk.feedIdForLabel("tessera:T-OpenAI"));
const prestocks = await sdk.fetchPrice(rpc, await sdk.feedIdForLabel("prestocks:ANTHROPIC"));
console.log("cache", await sdk.pda.priceCache(await sdk.feedIdForLabel("tessera:T-OpenAI")));   // ["price", feed_id] under window_credit
console.log(Number(tessera.price) * 10 ** tessera.expo, "USD, fetched", new Date(Number(tessera.publishTime) * 1000));
console.log(Number(prestocks.price) * 10 ** prestocks.expo, "USD, fetched", new Date(Number(prestocks.publishTime) * 1000));

// what the keeper reads (server side — these APIs answer no CORS preflight):
//   curl -s https://rest-api.tessera.pe/v1/public/token-details | jq '.[] | select(.mint=="oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ") | .markPrice'
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
      return {
        tessera: await one("tessera:T-OpenAI", "https://rest-api.tessera.pe/v1/public/token-details"),
        prestocks: await one("prestocks:ANTHROPIC", "https://prestocks.com/api/prestocks"),
        note: "attested marks: publish_time is the keeper's fetch time; the on-chain limit for these listings is 48 h",
      };
    },
  },
  {
    id: "solvency",
    title: "What 1,000 USDC costs in collateral on each listing",
    blurb:
      "The scalars the program forms E_delta with: k_c from the listing's mark and the mint's multiplier, k_l from its haircut; then the pledge the desk asks for. Pure math over the same accounts.",
    code: (ctx) => `${PRELUDE(ctx)}

const LOAN = 1_000_000_000n;                                       // 1,000 USDC in micro-USDC
for (const { data: l } of await sdk.fetchListings(rpc)) {
  const price = await sdk.fetchPrice(rpc, new Uint8Array(l.feedId));
  const mult  = await sdk.fetchMultiplier(rpc, l.mockMint);        // ScaledUiAmount on the mock mint
  const s = sdk.solvencyScalars(sdk.priceCents(price.price, price.expo), sdk.multiplierScaled(mult.multiplier), l.haircutBps);
  console.log(sdk.symbolOf(l), "k_c", s.kC, "k_l", s.kL, "required", sdk.collateralRequired(LOAN, s), "pledge", sdk.collateralPledge(LOAN, s), "milli-shares");
}`,
    run: async (ctx) => {
      const LOAN = 1_000_000_000n;
      const out = [];
      for (const { data: l } of await ctx.sdk.fetchListings(ctx.rpc)) {
        const price = await ctx.sdk.fetchPrice(ctx.rpc, new Uint8Array(l.feedId));
        if (!price) continue;
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
      return { loanUsdc: 1000, listings: out };
    },
  },
  {
    id: "latest-print",
    title: "The last print and its curve",
    blurb:
      "Read the proven per-tick sums, rebuild the depth curve and clear it locally — the same math the administrator ran.",
    code: (ctx) => `${PRELUDE(ctx)}

const oracle = await sdk.fetchOracle(rpc);
const print  = await sdk.fetchPrint(rpc, oracle.lastPrintEpoch);
const { curve, clearing } = sdk.depthFromPrint(print);   // clearing === sdk.clear(curve)
console.log(sdk.formatRate(clearing.rStar), clearing.matched, sdk.cumulative(curve));`,
    run: async (ctx) => {
      const oracle = await ctx.sdk.fetchOracle(ctx.rpc);
      if (!oracle?.hasPrinted) throw new Error("nothing printed yet");
      const print = await ctx.sdk.fetchPrint(ctx.rpc, oracle.lastPrintEpoch);
      if (!print) throw new Error("print account missing");
      const { curve, clearing } = ctx.sdk.depthFromPrint(print);
      const local = ctx.sdk.clear(curve);
      return {
        epoch: oracle.lastPrintEpoch,
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
    title: "Re-verify a print in this tab",
    blurb:
      "Fetch the epoch, the print and every attest transaction, then check each zero-ciphertext proof with the wasm verifier.",
    code: (ctx) => `${PRELUDE(ctx)}

const oracle = await sdk.fetchOracle(rpc);
const verdict = await sdk.verifyPrint(rpc, oracle.lastPrintEpoch, {
  onStage: (stage, d) => console.log(stage, d),   // accounts → signatures → transactions → proofs → verify
});
console.log(verdict.ok, verdict.proven, "/", verdict.nonzero, verdict.r_star_recomputed, verdict.failures);`,
    run: async (ctx) => {
      const oracle = await ctx.sdk.fetchOracle(ctx.rpc);
      if (!oracle?.hasPrinted) throw new Error("nothing printed yet");
      const t0 = performance.now();
      const verdict = await ctx.sdk.verifyPrint(ctx.rpc, oracle.lastPrintEpoch, {
        onStage: (stage, d) =>
          ctx.log(
            `${stage}${d?.count !== undefined ? ` ${d.count}${d.total !== undefined ? `/${d.total}` : ""}` : ""} · ${Math.round(performance.now() - t0)} ms`,
          ),
      });
      return { epoch: oracle.lastPrintEpoch, ...verdict, ms: Math.round(performance.now() - t0) };
    },
  },
  {
    id: "me",
    title: "My membership, bids and loans",
    blurb: "What the chain holds about one wallet: the member record (public), sealed bids, loans on both sides.",
    needs: "wallet",
    code: (ctx) => `${PRELUDE(ctx)}

const wallet = address("${ctx.wallet ?? "<your wallet>"}");
const member = await sdk.fetchMember(rpc, wallet);       // { elgamalPubkey, joinedEpoch, active } or null
const bids   = await sdk.fetchBidsFor(rpc, wallet);      // sealed: ciphertext only
const loans  = await sdk.fetchLoansFor(rpc, wallet);     // { borrowed, lent }, sizes as ciphertexts
console.log(member, bids.length, loans.borrowed.map((l) => sdk.LOAN_STATUS_NAMES[l.data.status]), loans.lent.length);`,
    run: async (ctx) => {
      if (!ctx.wallet) throw new Error("connect a wallet or take a burner first");
      const [member, bids, loans] = await Promise.all([
        ctx.sdk.fetchMember(ctx.rpc, ctx.wallet),
        ctx.sdk.fetchBidsFor(ctx.rpc, ctx.wallet),
        ctx.sdk.fetchLoansFor(ctx.rpc, ctx.wallet),
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
    blurb:
      "Encrypt a size to your key and the auditor key, prove it in range, and lay out the three transactions — without sending. Needs your derived keys.",
    needs: "keys",
    code: (ctx) => `${PRELUDE(ctx)}

const cfg   = await sdk.fetchAuctionConfig(rpc);
const epoch = await sdk.fetchEpoch(rpc, cfg.currentEpoch);   // carries the auditor key in force
const plan  = await sdk.buildBidPlan({
  member: signer,                         // your wallet (TransactionSigner)
  signature: memberSignature,             // wallet signature over sdk.memberSigningMessage() — never logged
  auditorPubkey: new Uint8Array(epoch.auditorPubkey),
  epoch: cfg.currentEpoch,
  side: 1,                                // 1 = borrow USDC, 0 = lend
  tick: 8,                                // sdk.formatRate(8) = "3.00%", sdk.tickToBps(8) = 300
  sizeMicroUsdc: 1_000_000_000n,          // 1,000 USDC
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
        side: 1,
        tick: 8,
        sizeMicroUsdc: 1_000_000_000n,
        sMin: cfg.sMin,
        rent: ctx.rentFor,
      });
      return {
        epoch: cfg.currentEpoch,
        rate: ctx.sdk.formatRate(8),
        bps: ctx.sdk.tickToBps(8),
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
    blurb:
      "Open a WebSocket, follow the auction, oracle and credit programs' logs, decode the Anchor events (EpochOpened, Printed, PricePosted per listing, MatchPosted…) — for 60 seconds.",
    code: (ctx) => `import { createSolanaRpcSubscriptions, getBase64Encoder } from "@solana/kit";
import * as sdk from "@thewindow/solana-sdk";
const subs = createSolanaRpcSubscriptions("${ctx.config.wsUrl}");
const logs = await subs
  .logsNotifications({ mentions: [sdk.PROGRAMS.oracle] }, { commitment: "confirmed" })
  .subscribe({ abortSignal: AbortSignal.timeout(60_000) });
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
            seconds: 60,
            events,
            note: events.length === 0 ? "no event in 60 s — the market may be paused" : undefined,
          });
        };
        const timer = setTimeout(done, 60_000);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          done();
        });
        ctx.log(`listening on ${ctx.config.wsUrl} for 60 s (oracle + auction) …`);
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
];
