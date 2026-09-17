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
const pdas = {
  auctionConfig: await sdk.pda.auctionConfig(),
  epoch: await sdk.pda.epoch(auction.currentEpoch),
  print: await sdk.pda.print(auction.currentEpoch),
};
console.log(sdk.PROGRAMS, auction, credit, oracle, pdas);`,
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
      return { programs: ctx.sdk.PROGRAMS, auction, credit, oracle, pdas };
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
    blurb: "Open a WebSocket, follow the auction and oracle programs' logs, decode the Anchor events — for 60 seconds.",
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
          programs: ["oracle", "auction"],
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
