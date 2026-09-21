#!/usr/bin/env node
// Generates docs/tracks.excalidraw — the track-integration diagram (Pyth · PreStocks · the lender agent on Meteora DBC + Clawpump).
// Run `node scripts/tracks_diagram.mjs` after changing the layout below; app/src/lib/excalidraw.test.ts
// checks that every arrow and label binding in the emitted file points at a real element.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "tracks.excalidraw");

// One colour per track; the desk is grey.
const C = {
  pyth: { stroke: "#6d28d9", bg: "#ede9fe" },
  prestocks: { stroke: "#c2410c", bg: "#ffedd5" },
  desk: { stroke: "#1f2937", bg: "#f3f4f6" },
  chain: { stroke: "#065f46", bg: "#d1fae5" },
  app: { stroke: "#0f766e", bg: "#ccfbf1" },
  frame: { stroke: "#9ca3af", bg: "transparent" },
  stage4: { stroke: "#7c3aed", bg: "#faf5ff" },
  launch: { stroke: "#b45309", bg: "#fef3c7" },
};

let seed = 1;
const nonce = () => (seed = (seed * 48271) % 2147483647);
const elements = [];
const byId = new Map();

const base = (id, type, x, y, w, h, o = {}) => ({
  id,
  type,
  x,
  y,
  width: w,
  height: h,
  angle: 0,
  strokeColor: o.stroke ?? C.desk.stroke,
  backgroundColor: o.bg ?? "transparent",
  fillStyle: "solid",
  strokeWidth: o.strokeWidth ?? 1,
  strokeStyle: o.dashed ? "dashed" : "solid",
  roughness: 0,
  opacity: 100,
  groupIds: o.groups ?? [],
  frameId: null,
  index: null,
  roundness: type === "rectangle" ? { type: 3 } : null,
  seed: nonce(),
  version: 1,
  versionNonce: nonce(),
  isDeleted: false,
  boundElements: [],
  updated: 1,
  link: null,
  locked: false,
});

const add = (el) => {
  elements.push(el);
  byId.set(el.id, el);
  return el;
};

/** A rectangle with a bound, centred text. */
function box(id, x, y, w, h, text, o = {}) {
  const r = add(base(id, "rectangle", x, y, w, h, o));
  const t = add({
    ...base(`${id}.t`, "text", x + 8, y + 8, w - 16, h - 16, { stroke: o.textColor ?? o.stroke ?? C.desk.stroke }),
    roundness: null,
    text,
    originalText: text,
    fontSize: o.fontSize ?? 13,
    fontFamily: 3,
    textAlign: o.align ?? "center",
    verticalAlign: "middle",
    containerId: id,
    autoResize: true,
    lineHeight: 1.25,
  });
  r.boundElements.push({ type: "text", id: t.id });
  return r;
}

/** A dashed frame with a title in its top-left corner (a rectangle, so every viewer renders it). */
function frame(id, x, y, w, h, title, o = {}) {
  const r = add(
    base(id, "rectangle", x, y, w, h, { stroke: o.stroke ?? C.frame.stroke, dashed: true, strokeWidth: 1 }),
  );
  add({
    ...base(`${id}.title`, "text", x + 12, y + 8, w - 24, 20, { stroke: o.stroke ?? C.frame.stroke }),
    roundness: null,
    text: title,
    originalText: title,
    fontSize: 14,
    fontFamily: 3,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  });
  return r;
}

const center = (e) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

/** Where an arrow leaves/enters a box, chosen from the relative position of the two boxes. */
function port(from, to) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) * from.height >= Math.abs(dy) * from.width) {
    return dx > 0 ? { x: from.x + from.width, y: a.y } : { x: from.x, y: a.y };
  }
  return dy > 0 ? { x: a.x, y: from.y + from.height } : { x: a.x, y: from.y };
}

/** An arrow bound to two elements, with an optional label bound to the arrow. */
function arrow(id, fromId, toId, label, o = {}) {
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (!from || !to) throw new Error(`arrow ${id}: unknown endpoint ${fromId} → ${toId}`);
  const p = port(from, to);
  const q = port(to, from);
  const a = add({
    ...base(id, "arrow", p.x, p.y, q.x - p.x, q.y - p.y, {
      stroke: o.stroke ?? C.desk.stroke,
      dashed: o.dashed,
      strokeWidth: o.strokeWidth ?? 1,
    }),
    roundness: { type: 2 },
    points: [
      [0, 0],
      [q.x - p.x, q.y - p.y],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: fromId, focus: 0, gap: 4 },
    endBinding: { elementId: toId, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  });
  from.boundElements.push({ type: "arrow", id });
  to.boundElements.push({ type: "arrow", id });
  if (label) {
    const mid = { x: p.x + (q.x - p.x) / 2, y: p.y + (q.y - p.y) / 2 };
    const t = add({
      ...base(`${id}.label`, "text", mid.x - 70, mid.y - 10, 140, 20, { stroke: o.stroke ?? C.desk.stroke }),
      roundness: null,
      text: label,
      originalText: label,
      fontSize: 11,
      fontFamily: 3,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: id,
      autoResize: true,
      lineHeight: 1.25,
    });
    a.boundElements.push({ type: "text", id: t.id });
  }
  return a;
}

function note(id, x, y, w, text, o = {}) {
  return add({
    ...base(id, "text", x, y, w, 20, { stroke: o.stroke ?? C.desk.stroke }),
    roundness: null,
    text,
    originalText: text,
    fontSize: o.fontSize ?? 12,
    fontFamily: 3,
    textAlign: o.align ?? "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  });
}

// ───────────────────────────────── layout ─────────────────────────────────
// Columns: sources (x 40) → keeper (x 620) → devnet (x 1180) → dashboard (x 1900). Stage 4 overlay along the bottom.

note(
  "title",
  40,
  20,
  1200,
  "THE WINDOW for Stocks — track integration: one xONIA rate, a collateral schedule (Pyth · PreStocks) · the lender agent (Meteora DBC · Clawpump)",
  { fontSize: 22 },
);
note(
  "subtitle",
  40,
  52,
  1400,
  "Stage badges: ① keeper freshness  ② dashboard panel  ③ Listing upgrade  ④ Pyth's own account read on chain (dashed = waits for the key). Frames are trust boundaries. docs/TRACKS.md is the written record.",
  { fontSize: 12 },
);

// Trust boundaries
frame(
  "tb.pyth",
  20,
  90,
  1080,
  330,
  "PYTH-SIGNED — the quote carries the publisher's own timestamp (and, after ④, its signature)",
  { stroke: C.pyth.stroke },
);
frame(
  "tb.attested",
  20,
  440,
  1080,
  300,
  "KEEPER-ATTESTED — public API marks copied by the keeper, publish_time = fetch time (stated on chain and in the UI)",
  { stroke: C.prestocks.stroke },
);
frame(
  "tb.chain",
  1140,
  90,
  700,
  1010,
  "CHAIN-ENFORCED — devnet · window_credit (+ window_wrap · rate side unchanged)",
  { stroke: C.chain.stroke },
);
frame("tb.app", 1880, 90, 560, 1010, "DASHBOARD — GitHub Pages, reads chain only", { stroke: C.app.stroke });
frame(
  "tb.stage4",
  20,
  780,
  1080,
  300,
  "④ BUILT (program + poster, 18 Sep) — the Pyth listing reads Pyth's receiver-owned account; the program trusts Pyth, not the keeper's copy. Devnet flip waits for PYTH_API_KEY",
  { stroke: C.stage4.stroke },
);

// Sources
box(
  "s.hermes",
  40,
  130,
  300,
  120,
  "① Pyth Hermes (bearer key)\npyth.dourolabs.app/hermes\nGET /v2/updates/price/latest?ids[]=…&parsed=true\nAuthorization: Bearer $PYTH_API_KEY\nCrypto.TSLAX/USD · 24/7 feed",
  C.pyth,
);
box(
  "s.pyth.accounts",
  40,
  270,
  300,
  130,
  "Pyth PriceUpdateV2 accounts (mainnet)\nowner rec5EK… · push PDA [shard, feed_id]\nEquity.US.TSLA/USD shard 1 FQB8c4… ✓ live\nCrypto.TSLAX/USD shard 0 GpoWLT… ✕ stale since 12 Sep\n(read keyless; browsers via solana-rpc.publicnode.com)",
  C.pyth,
);
box(
  "s.prestocks",
  40,
  610,
  300,
  110,
  "③ PreStocks public API\nprestocks.com/api/prestocks\nANTHROPIC · Pren1FvF… · markPrice · tokenPrice\n(tokenPrice vs markPrice = PreStocks basis)",
  C.prestocks,
);

// Keeper
frame(
  "f.keeper",
  600,
  120,
  480,
  600,
  "KEEPER — services/admin (administrator · keeper · operator, one disclosed key)",
  { stroke: C.desk.stroke },
);
box(
  "k.pyth",
  620,
  160,
  440,
  110,
  "① PriceSource · TSLAx-mock\nHermes → on-chain fallback (freshest of shards 0/1)\nowner == Pyth receiver · feed id == listing.feed_id\nquote age logged + metric price_publish_age_seconds",
  C.pyth,
);
box(
  "k.check",
  620,
  290,
  440,
  60,
  "① window-admin price-check\nfetch + print price/expo/publish_time/age, no transaction",
  C.pyth,
);
box(
  "k.prestocks",
  620,
  610,
  440,
  90,
  "③ PriceSource · ANTHROPIC-mock\nmarkPrice → price = round(v·1e8), expo −8\npublish_time = fetch time (attested, not a feed)",
  C.prestocks,
);
box(
  "k.post",
  620,
  380,
  440,
  70,
  "post_price(listing, price, expo, publish_time)\nat every epoch open and at listing.max_price_age / 2\nper listing · rejects publish_time > now + 60 s",
  C.desk,
);

// Devnet
box(
  "d.config",
  1160,
  130,
  300,
  90,
  'Config ["config"] — frozen at initialize\nadmin · operator · keeper · tenor_slots\n(legacy collateral fields mirrored by listing #0)',
  C.chain,
);
box(
  "d.admin",
  1500,
  130,
  320,
  90,
  "③ add_listing / update_listing / migrate_loan\nadmin-only · limits tunable without an upgrade\n59 legacy loans resized 414 → 446 B",
  C.chain,
);

box(
  "d.listing.tsla",
  1160,
  250,
  300,
  110,
  '③ Listing ["listing", cstock_mint]\nTSLAx-mock · price_source Pyth (0)\nhaircut 150 % · max_price_age 1200 slots\nmax_publish_age 3 600 s',
  C.pyth,
);
box(
  "d.listing.anthropic",
  1160,
  510,
  300,
  110,
  '③ Listing ["listing", cstock_mint]\nANTHROPIC-mock · price_source PreStocks (2)\nhaircut 200 % · max_price_age 1200 slots\nmax_publish_age 172 800 s',
  C.prestocks,
);

box(
  "d.cache.tsla",
  1500,
  250,
  320,
  110,
  'PriceCache ["price", feed_id]\nfeed_id 0x47a15647…a362 (Pyth id)\nprice · expo · publish_time (unmodified) · posted_slot\nsame PDA as before the upgrade — history continues',
  C.pyth,
);
box(
  "d.cache.anthropic",
  1500,
  510,
  320,
  110,
  'PriceCache ["price", feed_id]\nfeed_id = sha256("prestocks:ANTHROPIC") — a label\nprice · expo · publish_time = fetch time · posted_slot',
  C.prestocks,
);

box(
  "d.guards",
  1160,
  660,
  660,
  150,
  "lock_collateral · seize — guards (both on chain, per listing)\n① slot − price.posted_slot ≤ listing.max_price_age            (keeper alive)\n② now − price.publish_time ≤ listing.max_publish_age_secs   (quote fresh — NEW)\nsolvency:  E_Δ = k_c·E_c − k_l·E_ℓ ,   k_c ← price_scaled(price, expo) × multiplier ,   k_l ← haircut\n→ Pyth data doing work: no fresh price ⇒ no lock, no seizure",
  { ...C.chain, strokeWidth: 2 },
);

box(
  "d.loan",
  1160,
  840,
  300,
  100,
  "Loan { lender, borrower, epoch, tick, …, k_c, k_l,\nsize_ct, collateral_ct, delta_commitment, listing }\nlisting bound at lock; deposit/seize/release check it",
  C.chain,
);
box(
  "d.rate",
  1500,
  840,
  320,
  100,
  "Rate side — unchanged\nwindow_auction sealed bids → window_oracle proven print\n→ xONIA r* → post_match → Loan (listing = default)",
  C.desk,
);
box(
  "d.wrap",
  1160,
  970,
  660,
  100,
  'window_wrap — Vault ["vault", mock_mint] per listing (no change)\n<symbol>-mock: Token-2022 ScaledUiAmount + PermanentDelegate  ⇄ 1:1 ⇄  cSTOCK (ConfidentialTransferMint, auditor key)\nescrow_account per listing = operator\'s confidential cSTOCK account',
  C.desk,
);

// Dashboard
box(
  "a.rpc",
  1900,
  130,
  520,
  80,
  "② RPC: devnet (Listings · PriceCaches · Loans · Epochs)\nmainnet via VITE_MAINNET_RPC_URL ?? solana-rpc.publicnode.com\n(api.mainnet-beta answers 403 to browsers)",
  C.app,
);
box(
  "a.market",
  1900,
  250,
  520,
  200,
  "Market — collateral schedule ②③\nsymbol · source (link) · price · quote age vs max_publish_age (red when stale)\nposted age vs max_price_age · haircut · multiplier\n\nTSLAx row: desk quote (Crypto.TSLAX/USD) vs underlying Equity.US.TSLA/USD\nwrapper basis (bps) · equity session open/closed (09:30–16:00 ET)\n— the overnight window opens when the equity market closes",
  C.app,
);
box(
  "a.desk",
  1900,
  480,
  520,
  100,
  "Desk ③ — listing selector\n→ derive keys → join → confidential account (per listing ATA)\n→ wrap <symbol>-mock → sealed bid",
  C.app,
);
box(
  "a.positions",
  1900,
  610,
  520,
  100,
  "Positions ③ — lock({loan, listing}) with that listing's price + haircut\n→ confidential deposit into the listing's escrow → lifecycle track\nlisting badge on every loan",
  C.app,
);
box(
  "a.explorer",
  1900,
  740,
  520,
  70,
  "Explorer — unchanged\nre-verifies each print's proofs in the browser (wasm)",
  C.desk,
);
box(
  "a.legend",
  1900,
  850,
  520,
  220,
  "LEGEND\nviolet = Pyth track · orange = PreStocks track · amber = the lender agent (Part B)\ngreen = enforced on chain · teal = dashboard · grey = unchanged desk\ndashed frames = trust boundaries · dashed arrows = fallback / stretch\n\nHonest limits: the PreStocks mark is a keeper-attested copy of a public API;\n-mock mints are devnet twins; the administrator can decrypt individual amounts\n(accountable privacy, unchanged).",
  { ...C.desk, align: "left", fontSize: 12 },
);

// Stage 4 overlay
box(
  "x.poster",
  40,
  830,
  440,
  110,
  "④ services/pyth-poster (Node · web3.js v1)\n@pythnetwork/hermes-client (bearer key) → VAA\n@pythnetwork/pyth-solana-receiver updatePriceFeed\n→ devnet push PDA [shard 7001, feed_id] (rent once, then fees)",
  C.stage4,
);
box(
  "x.receiver",
  540,
  830,
  520,
  110,
  "④ Pyth receiver on devnet rec5EK… (+ Wormhole HDwcJB…)\nverifies the VAA, writes PriceUpdateV2 { feed_id, price, expo, publish_time, verification Full }\nowner = receiver — the keeper never touches the bytes",
  C.stage4,
);
box(
  "x.rule",
  40,
  970,
  1020,
  90,
  "④ window_credit quote.rs: Listing.price_source = 4 → lock_collateral / seize read the receiver's account, not PriceCache\nowner == rec5EK… · feed_id == listing.feed_id · verification == Full · both age rules on Pyth's own publish_time / posted_slot\nBadPriceAccount · WrongFeed · attack_11 (7 cases, LiteSVM set_account) · window-admin listing-set-source mock_tsla 4 (refuses a stale account)",
  C.stage4,
);

// Arrows — sources → keeper
arrow("e.hermes.k", "s.hermes", "k.pyth", "parsed price, id checked", C.pyth);
arrow("e.accounts.k", "s.pyth.accounts", "k.pyth", "fallback: freshest shard", { ...C.pyth, dashed: true });
arrow("e.prestocks.k", "s.prestocks", "k.prestocks", "markPrice", C.prestocks);
// keeper → post → caches
arrow("e.kpyth.post", "k.pyth", "k.post", null, C.pyth);
arrow("e.kpre.post", "k.prestocks", "k.post", null, C.prestocks);
arrow("e.post.tsla", "k.post", "d.cache.tsla", "post_price", C.pyth);
arrow("e.post.anthropic", "k.post", "d.cache.anthropic", "post_price", C.prestocks);
// listing ↔ cache seeds
arrow("e.l.tsla", "d.listing.tsla", "d.cache.tsla", "seeds on listing.feed_id", C.pyth);
arrow("e.l.anthropic", "d.listing.anthropic", "d.cache.anthropic", "seeds on listing.feed_id", C.prestocks);
// admin
arrow("e.admin.listing", "d.admin", "d.listing.tsla", "add_listing (TSLAx first, same feed id)", C.chain);
arrow("e.config.admin", "d.config", "d.admin", "has_one = admin", C.chain);
// guards
arrow("e.cache.guards", "d.cache.anthropic", "d.guards", "price · publish_time · posted_slot", C.chain);
arrow("e.listing.guards", "d.listing.anthropic", "d.guards", "haircut · limits · mints", C.chain);
arrow("e.guards.loan", "d.guards", "d.loan", "binds loan.listing at lock", C.chain);
arrow("e.rate.loan", "d.rate", "d.loan", "post_match", C.desk);
arrow("e.wrap.guards", "d.wrap", "d.guards", "cSTOCK collateral (confidential)", C.desk);
arrow("e.admin.loan", "d.admin", "d.loan", "migrate_loan (+32 B)", { ...C.chain, dashed: true });
// dashboard
arrow("e.rpc.market", "a.rpc", "a.market", null, C.app);
arrow("e.cache.rpc", "d.cache.tsla", "a.rpc", "PriceCaches · Listings", C.app);
arrow("e.accounts.rpc", "s.pyth.accounts", "a.rpc", "② Equity.US.TSLA/USD (keyless)", { ...C.pyth, dashed: true });
arrow("e.desk.wrap", "a.desk", "d.wrap", "wrap(listing)", C.app);
arrow("e.positions.guards", "a.positions", "d.guards", "lock_collateral(listing) · deposit", C.app);
// stage 4
arrow("e.hermes.poster", "s.hermes", "x.poster", "④ VAA (bearer key)", { ...C.stage4, dashed: true });
arrow("e.poster.receiver", "x.poster", "x.receiver", "updatePriceFeed", C.stage4);
arrow("e.receiver.rule", "x.receiver", "x.rule", null, C.stage4);
arrow("e.rule.guards", "x.rule", "d.guards", "④ read Pyth's account directly", {
  ...C.stage4,
  strokeWidth: 2,
});

// ───────────────────────────── Part B: the lender agent ─────────────────────────────
frame(
  "tb.launch",
  20,
  1120,
  2420,
  330,
  "PART B (21 Sep) — THE LENDER AGENT: its token on a stock-quoted Meteora Dynamic Bonding Curve, configured from the desk's numbers; its identity on Clawpump. services/launch · sdk/src/dbc.ts · LenderAgent.tsx",
  { stroke: C.launch.stroke },
);
box(
  "b.agent",
  40,
  1170,
  400,
  120,
  "The lender agent (services/admin, the simulated lenders)\nquotes every window · lends USDC against cSTOCK collateral\nproven solvent in ZK · earns xONIA\n→ Clawpump identity: POST /api/v1/agents → { id, walletAddress }",
  C.launch,
);
box(
  "b.plan",
  500,
  1170,
  520,
  120,
  "services/launch plan (buildCurveWithMarketCap)\n$25,000 → $250,000 fully diluted ÷ Pyth price of the quote stock\n(Crypto.TSLAX/USD while fresh, else Equity.US.TSLA/USD — recorded)\nfee 300 → 30 bp over one tenor (4 h) · fees in quote · creator = the agent's wallet",
  C.launch,
);
box(
  "b.pool",
  1160,
  1170,
  660,
  120,
  "Meteora DBC pool — program dbcij3LW… (mainnet + devnet)\ncreateConfigAndPool: the pool mints WLEND (1e9, 6 dp)\nquote = TSLAx XsDoVfqe… (Meteora-badged) on mainnet · twin GY41SK2W… on devnet\ngraduation → DAMM v2, both LP positions locked · 10 % of the raise + 50 % of fees → the agent",
  C.launch,
);
box(
  "b.card",
  1900,
  1170,
  520,
  120,
  "Market: the lender agent card · Build: launch-status recipe\nsdk.fetchDbc — VirtualPool + PoolConfig decoded from raw bytes\n(owner-checked, fixtures from the devnet pool) · progress, raise vs\nthreshold in quote and USD (Pyth), fully diluted value, fees, spot",
  C.app,
);
box(
  "b.evidence",
  40,
  1330,
  1780,
  90,
  "Verified on devnet 21 Sep: pool EZyMqXWB…6BTg · config HsfeZeTw…GPZr · WLEND 72QJmsn4…ZL1m · launch tx 5aadUBpt…AmmP · buy 5 → 2.9 % of 168.50 quote raised · fees 0.06 / 0.06\nMainnet launch is one command once the launch key holds ~0.5 SOL; the Clawpump agent needs a cpk_ key. Honest: the pool and fees are real on the named cluster; the lending loop is the devnet desk; Clawpump's own venue is pump.fun.",
  { ...C.launch, align: "left", fontSize: 12 },
);
arrow("e.pyth.plan", "s.pyth.accounts", "b.plan", "the same Pyth read", { ...C.pyth, dashed: true });
arrow("e.agent.plan", "b.agent", "b.plan", "creator · fee wallet", C.launch);
arrow("e.plan.pool", "b.plan", "b.pool", "config + pool, one tx", C.launch);
arrow("e.pool.card", "b.pool", "b.card", "raw account bytes", C.app);
arrow("e.card.evidence", "b.pool", "b.evidence", null, { ...C.launch, dashed: true });

const file = {
  type: "excalidraw",
  version: 2,
  source: "https://github.com/kaustubh76/Blinds — scripts/tracks_diagram.mjs",
  elements,
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: {},
};
writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
console.log(`wrote ${OUT}: ${elements.length} elements`);
