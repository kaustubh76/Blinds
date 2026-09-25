#!/usr/bin/env node
// Generates docs/project.excalidraw — the whole-product map: every program, instruction, account, proof,
// service loop, SDK module, dashboard page, test tier and track, each status-badged (LIVE · BUILT · gated ·
// IN PROGRESS · PLANNED · RETIRED · DROPPED · ROADMAP · CORE). docs/tracks.excalidraw stays the track-only view.
//
//   node scripts/project_diagram.mjs           # rewrite docs/project.excalidraw
//   node scripts/project_diagram.mjs --check   # exit 1 when the committed file is stale (CI)
//
// Nothing here is positioned by hand: boxes size themselves from their text, columns stack them, frames wrap
// their children, and arrows route along corridors computed from the frames. The status of the Meteora +
// Clawpump work (Part B) is read from the working tree at generation time, never asserted.
// app/src/lib/excalidraw.test.ts checks that every binding in the emitted file points at a real element.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "project.excalidraw");
const CHECK = process.argv.includes("--check");

// ───────────────────────────── palette · statuses ─────────────────────────────
const C = {
  desk: { stroke: "#1f2937", bg: "#f3f4f6" },
  chain: { stroke: "#065f46", bg: "#d1fae5" },
  ext: { stroke: "#475569", bg: "#f1f5f9" },
  crypto: { stroke: "#4338ca", bg: "#e0e7ff" },
  app: { stroke: "#0f766e", bg: "#ccfbf1" },
  pyth: { stroke: "#6d28d9", bg: "#ede9fe" },
  prestocks: { stroke: "#c2410c", bg: "#ffedd5" },
  meteora: { stroke: "#b45309", bg: "#fef3c7" },
  xstocks: { stroke: "#0369a1", bg: "#e0f2fe" },
  retired: { stroke: "#6b7280", bg: "#f3f4f6", dashed: true },
  roadmap: { stroke: "#1d4ed8", bg: "#dbeafe" },
  member: { stroke: "#0f766e", bg: "#ccfbf1" },
  public: { stroke: "#374151", bg: "#f9fafb" },
  leak: { stroke: "#9f1239", bg: "#ffe4e6" },
  tests: { stroke: "#334155", bg: "#f1f5f9" },
  frame: { stroke: "#9ca3af", bg: "transparent" },
};

const STATUS = {
  LIVE: { label: "LIVE", stroke: "#166534", bg: "#dcfce7" },
  BUILT: { label: "BUILT · gated", stroke: "#6d28d9", bg: "#ede9fe" },
  INPROGRESS: { label: "IN PROGRESS", stroke: "#b45309", bg: "#fef3c7" },
  PLANNED: { label: "PLANNED", stroke: "#b45309", bg: "#fef3c7", dashed: true },
  RETIRED: { label: "RETIRED", stroke: "#6b7280", bg: "#f3f4f6", dashed: true },
  DROPPED: { label: "DROPPED", stroke: "#6b7280", bg: "#f3f4f6", dashed: true },
  ROADMAP: { label: "ROADMAP", stroke: "#1d4ed8", bg: "#dbeafe", dashed: true },
  CORE: { label: "CORE", stroke: "#1f2937", bg: "#e5e7eb" },
};

// Part B (Meteora DBC + Clawpump). Say what exists, not what is hoped — and read the file the launch
// actually writes: `deployments/launch-mainnet.json`. This checked `launch.json`, which has never
// existed under any name, so every Part B box stayed amber and "not yet committed" after it shipped.
const partB = (() => {
  const launched = existsSync(join(ROOT, "deployments", "launch-mainnet.json"));
  const service = existsSync(join(ROOT, "services", "launch", "src", "main.ts"));
  const sdk = existsSync(join(ROOT, "sdk", "src", "dbc.ts"));
  const card = existsSync(join(ROOT, "app", "src", "features", "market", "LenderAgent.tsx"));
  const status = launched ? "LIVE" : service || sdk ? "INPROGRESS" : "PLANNED";
  const have = [service && "services/launch/src", sdk && "sdk/src/dbc.ts", card && "LenderAgent.tsx"].filter(Boolean);
  const line = launched
    ? "Status: LIVE — the pool and the identity coin are on mainnet (25 Sep), see deployments/launch-mainnet.json."
    : service || sdk
      ? `Status: IN PROGRESS — in the working tree today (21 Sep): ${have.join(" · ")}; not yet committed.`
      : "Status: PLANNED — decided 21 Sep, no code yet (plan in docs/TRACKS.md Part B).";
  return { status, line, service, sdk, card };
})();

// ───────────────────────────── metrics · registry ─────────────────────────────
const FONT = 13;
const LH = 1.25;
const PAD = 8;
const CW = 7.8; // px per character at 13 px, fontFamily 3 — over-estimated on purpose
const WIDE = /[^\x20-\x7e]/g; // glyphs from fallback fonts (→ · ① ≤ ℓ Δ ‖) are wider

const lineW = (s, cw = CW) => (s.length + (s.match(WIDE)?.length ?? 0) * 0.4) * cw;
const textW = (lines, cw = CW) => Math.ceil(Math.max(...lines.map((l) => lineW(l, cw))));
const textH = (lines, fs = FONT) => Math.ceil(lines.length * fs * LH);
const maxChars = (w, cw = CW) => Math.floor((w - 2 * PAD) / cw);

/** Word wrap to a character budget; a first-line budget leaves room for the status pill. */
function wrap(text, max, firstMax = max) {
  const out = [];
  const fill = (raw, indent, budget0, target0) => {
    const lines = [];
    let budget = budget0;
    let target = target0;
    let line = indent;
    for (const word of raw.trim().split(" ")) {
      if (lineW(word) > max * CW) throw new Error(`token too wide for the column: "${word}"`);
      const next = line.trim() ? `${line} ${word}` : `${line}${word}`;
      if (lineW(next) > Math.min(budget, target) * CW && line.trim()) {
        lines.push(line);
        line = `${indent}  ${word}`;
        budget = max;
        target = target0;
      } else line = next;
    }
    lines.push(line);
    return lines;
  };
  for (const raw of text.split("\n")) {
    const indent = raw.match(/^\s*/)[0];
    const budget = out.length === 0 ? firstMax : max;
    if (lineW(raw) <= budget * CW) {
      out.push(raw);
      continue;
    }
    // balanced (even pieces) unless plain greedy needs fewer lines — never a full line plus a short orphan
    const eq = lineW(raw) / CW;
    const pieces = Math.ceil(eq / budget);
    const balanced = fill(raw, indent, budget, Math.ceil(eq / pieces) + 3);
    const greedy = fill(raw, indent, budget, max);
    out.push(...(greedy.length < balanced.length ? greedy : balanced));
  }
  return out;
}

let seed = 7;
const nonce = () => (seed = (seed * 48271) % 2147483647);
const elements = [];
const byId = new Map();
const F = {}; // frame rectangles by id, for corridors

const register = (el) => {
  if (byId.has(el.id)) throw new Error(`duplicate id ${el.id}`);
  byId.set(el.id, el);
  return el;
};
const add = (el) => {
  register(el);
  elements.push(el);
  return el;
};
const need = (id) => {
  const el = byId.get(id);
  if (!el) throw new Error(`unknown element ${id}`);
  return el;
};

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
  strokeStyle: o.dotted ? "dotted" : o.dashed ? "dashed" : "solid",
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

const textEl = (id, x, y, w, h, text, o) => ({
  ...base(id, "text", x, y, w, h, { stroke: o.stroke, groups: o.groups }),
  roundness: null,
  text,
  originalText: text,
  fontSize: o.fontSize ?? FONT,
  fontFamily: 3,
  textAlign: o.align ?? "left",
  verticalAlign: o.valign ?? "middle",
  containerId: o.containerId ?? null,
  autoResize: true,
  lineHeight: LH,
});

// ───────────────────────────── boxes · badges · frames ─────────────────────────────
function badge(id, x, y, status, groups = []) {
  const s = STATUS[status];
  if (!s) throw new Error(`${id}: unknown status ${status}`);
  const fs = 10;
  const cw = (CW * fs) / FONT;
  const tw = Math.ceil(lineW(s.label, cw));
  const th = Math.ceil(fs * LH);
  const bw = tw + 14;
  const bh = 18;
  const r = add(base(id, "rectangle", x, y, bw, bh, { stroke: s.stroke, bg: s.bg, dashed: s.dashed, groups }));
  const t = add(
    textEl(`${id}.t`, x + 7, y + (bh - th) / 2, tw, th, s.label, {
      stroke: s.stroke,
      groups,
      fontSize: fs,
      align: "center",
      containerId: id,
    }),
  );
  r.boundElements.push({ type: "text", id: t.id });
  return r;
}

const badgeWidth = (status) => Math.ceil(lineW(STATUS[status].label, (CW * 10) / FONT)) + 14;

/** A rectangle sized from its (wrapped) text, with an optional status pill on its top-right border. */
function autoBox(id, x, y, w, text, o = {}) {
  const max = maxChars(w);
  const lines = wrap(text, max, o.status ? max - Math.ceil((badgeWidth(o.status) + 14) / CW) : max);
  const tw = textW(lines);
  const th = textH(lines);
  const h = th + 2 * PAD;
  const groups = [`g.${id}`];
  const align = o.align ?? "left";
  const r = add(base(id, "rectangle", x, y, w, h, { ...o, groups }));
  const body = lines.join("\n");
  const t = add(
    textEl(`${id}.t`, align === "center" ? x + (w - tw) / 2 : x + PAD, y + PAD, tw, th, body, {
      stroke: o.textColor ?? o.stroke ?? C.desk.stroke,
      groups,
      align,
      containerId: id,
    }),
  );
  r.boundElements.push({ type: "text", id: t.id });
  if (o.status) {
    const b = badge(`${id}.badge`, 0, 0, o.status, groups);
    b.x = x + w - b.width - 6;
    b.y = y - b.height / 2;
    const bt = need(`${id}.badge.t`);
    bt.x = b.x + (b.width - bt.width) / 2;
    bt.y = b.y + (b.height - bt.height) / 2;
  }
  return r;
}

function note(id, x, y, text, o = {}) {
  const lines = text.split("\n");
  const fs = o.fontSize ?? 12;
  const cw = (CW * fs) / FONT;
  return add(
    textEl(id, x, y, textW(lines, cw), textH(lines, fs), text, {
      stroke: o.stroke ?? C.desk.stroke,
      fontSize: fs,
      align: "left",
      valign: "top",
    }),
  );
}

/** A vertical flow of auto-sized boxes. */
function col(x, y, w, o = {}) {
  const gap = o.gap ?? 26;
  let cy = y;
  return {
    x,
    w,
    get y() {
      return cy;
    },
    box(id, text, bo = {}) {
      const b = autoBox(id, x, cy, w, text, bo);
      cy = b.y + b.height + gap;
      return b;
    },
    space(n) {
      cy += n;
    },
  };
}

/** A horizontal row of auto-sized boxes. */
function row(x, y, o = {}) {
  const gap = o.gap ?? 20;
  let cx = x;
  let bottom = y;
  return {
    box(id, w, text, bo = {}) {
      const b = autoBox(id, cx, y, w, text, bo);
      cx += w + gap;
      bottom = Math.max(bottom, b.y + b.height);
      return b;
    },
    get bottom() {
      return bottom;
    },
    get right() {
      return cx - gap;
    },
  };
}

const colsAt = (frameX, colW, n, y, gap = 20, o = {}) =>
  Array.from({ length: n }, (_, i) => col(frameX + 20 + i * (colW + gap), y, colW, o));

/** A dashed rectangle sized from the elements `build` adds, inserted behind them (Excalidraw draws in order). */
function frame(id, title, build, o = {}) {
  const mark = elements.length;
  build();
  const kids = elements.slice(mark);
  const x0 = Math.min(...kids.map((k) => k.x)) - 20;
  const y0 = Math.min(...kids.map((k) => k.y)) - 44;
  const x1 = Math.max(...kids.map((k) => k.x + k.width)) + 20 + (o.padRight ?? 0);
  const y1 = Math.max(...kids.map((k) => k.y + k.height)) + 20;
  const stroke = o.stroke ?? C.frame.stroke;
  const r = register(base(id, "rectangle", x0, y0, x1 - x0, y1 - y0, { stroke, dashed: true }));
  const cw = (CW * 14) / FONT;
  const tw = Math.ceil(lineW(title, cw));
  if (tw > x1 - x0 - 24) throw new Error(`${id}: title too long for the frame`);
  const t = register(
    textEl(`${id}.title`, x0 + 12, y0 + 10, tw, 18, title, { stroke, fontSize: 14, align: "left", valign: "top" }),
  );
  elements.splice(mark, 0, r, t);
  F[id] = r;
  return r;
}

const bottomOf = (...ids) => Math.max(...ids.map((id) => F[id].y + F[id].height));

// ───────────────────────────── arrows ─────────────────────────────
const cx = (e) => e.x + e.width / 2;
const cy = (e) => e.y + e.height / 2;
const SIDE = {
  l: (e, d = 0) => ({ x: e.x, y: cy(e) + d }),
  r: (e, d = 0) => ({ x: e.x + e.width, y: cy(e) + d }),
  t: (e, d = 0) => ({ x: cx(e) + d, y: e.y }),
  b: (e, d = 0) => ({ x: cx(e) + d, y: e.y + e.height }),
};

/** Where an arrow leaves `from` heading toward a point, or on an explicit side, offset along that side. */
function port(from, toward, side, d = 0) {
  if (side) return SIDE[side](from, d);
  const dx = toward.x - cx(from);
  const dy = toward.y - cy(from);
  if (Math.abs(dx) * from.height >= Math.abs(dy) * from.width) return dx > 0 ? SIDE.r(from, d) : SIDE.l(from, d);
  return dy > 0 ? SIDE.b(from, d) : SIDE.t(from, d);
}

/**
 * Corridors. A row gap is ROW_GAP px tall: horizontal lanes sit 15 px apart above the frame top of the row that
 * starts at `rowY`. A gutter is 180 px wide: vertical lanes sit 20 px apart around its centre `x` (a route without
 * a lane runs at `x` itself). Rotated labels ride the vertical runs, so the spacing leaves room for them.
 */
const ROW_GAP = 150;
const laneY = (rowY, lane = 0) => rowY - 44 - 16 - 15 * lane;
const laneX = (x, lane) => (lane === undefined ? x : x - 70 + 20 * lane);

function route(from, to, r) {
  const fd = r.fdx ?? 0;
  const td = r.tdx ?? 0;
  switch (r.kind) {
    case "H": {
      const y = r.y ?? laneY(r.rowY, r.lane);
      return {
        via: [
          { x: cx(from) + fd, y },
          { x: cx(to) + td, y },
        ],
        fromSide: from.y > y ? "t" : "b",
        toSide: to.y > y ? "t" : "b",
        fd,
        td,
      };
    }
    case "V": {
      const x = laneX(r.x, r.lane);
      return {
        via: [
          { x, y: cy(from) + fd },
          { x, y: cy(to) + td },
        ],
        fromSide: from.x > x ? "l" : "r",
        toSide: to.x > x ? "l" : "r",
        fd,
        td,
      };
    }
    case "VB": {
      // out of a side, along a gutter, along a band (y given by the caller), into a top/bottom
      const x = laneX(r.x, r.lane);
      const y = r.y;
      return {
        via: [
          { x, y: cy(from) + fd },
          { x, y },
          { x: cx(to) + td, y },
        ],
        fromSide: from.x > x ? "l" : "r",
        toSide: to.y > y ? "t" : "b",
        fd,
        td,
      };
    }
    case "HV": {
      // out of a top/bottom, along a lane, down/up a gutter, into a side
      const y = laneY(r.rowY, r.lane);
      const x = laneX(r.x, r.lane);
      return {
        via: [
          { x: cx(from) + fd, y },
          { x, y },
          { x, y: cy(to) + td },
        ],
        fromSide: from.y > y ? "t" : "b",
        toSide: to.x > x ? "l" : "r",
        fd,
        td,
      };
    }
    default:
      throw new Error(`unknown route kind ${r.kind}`);
  }
}

/**
 * Labels. A routed arrow labels its longest middle segment (a corridor lane or a gutter run — empty space).
 * A two-point arrow labels its only segment. Horizontal segments get a bound label centred on the line; any
 * other segment gets a free label rotated along the line, 9 px to its left, so it never sprawls across a box.
 */
function placeLabel(a, abs, routed, label, o) {
  let best = 0;
  let bestLen = -1;
  const lo = routed && abs.length > 3 ? 1 : 0;
  const hi = routed && abs.length > 3 ? abs.length - 2 : abs.length - 1;
  for (let i = lo; i < hi; i++) {
    const len = Math.hypot(abs[i + 1].x - abs[i].x, abs[i + 1].y - abs[i].y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const seg = o.labelAt ?? best;
  const p = abs[seg];
  const q = abs[seg + 1];
  if (seg !== best) bestLen = Math.hypot(q.x - p.x, q.y - p.y);
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  let ang = Math.atan2(q.y - p.y, q.x - p.x);
  if (ang > Math.PI / 2) ang -= Math.PI; // never upside down
  if (ang < -Math.PI / 2) ang += Math.PI;
  if (Math.abs(ang - Math.PI / 2) < 1e-6) ang = -Math.PI / 2; // a vertical run reads bottom-to-top
  const fs = 11;
  const lines = label.split("\n");
  const tw = textW(lines, (CW * fs) / FONT);
  const th = textH(lines, fs);
  const stroke = o.stroke ?? C.desk.stroke;
  // a label longer than its run would overhang the boxes at both ends: keep it horizontal, centred in the gap
  if (Math.abs(ang) < 0.02 || (!routed && bestLen < tw + 16)) {
    const t = add(
      textEl(`${a.id}.label`, mid.x - tw / 2, mid.y - th / 2, tw, th, label, {
        stroke,
        fontSize: fs,
        align: "center",
        containerId: a.id,
      }),
    );
    a.boundElements.push({ type: "text", id: t.id });
    return;
  }
  // Excalidraw rotates about the centre: put the centre 9 px to the left of the line's direction
  const off = { x: 9 * Math.sin(ang), y: -9 * Math.cos(ang) };
  const t = add(
    textEl(`${a.id}.label`, mid.x + off.x - tw / 2, mid.y + off.y - th / 2, tw, th, label, {
      stroke,
      fontSize: fs,
      align: "center",
    }),
  );
  t.angle = ang < 0 ? ang + 2 * Math.PI : ang;
}

function arrow(fromId, toId, label, o = {}) {
  const id = o.id ?? `e.${fromId}>${toId}`;
  const from = need(fromId);
  const to = need(toId);
  const r = o.route
    ? route(from, to, o.route)
    : { via: o.via ?? [], fromSide: o.from, toSide: o.to, fd: o.fdx ?? 0, td: o.tdx ?? 0 };
  const p = port(from, r.via[0] ?? { x: cx(to), y: cy(to) }, r.fromSide, r.fd);
  const q = port(to, r.via.at(-1) ?? { x: cx(from), y: cy(from) }, r.toSide, r.td);
  const abs = [p, ...r.via, q];
  const pts = abs.map((v) => [v.x - p.x, v.y - p.y]);
  const xs = pts.map((v) => v[0]);
  const ys = pts.map((v) => v[1]);
  const a = add({
    ...base(id, "arrow", p.x, p.y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      stroke: o.stroke ?? C.desk.stroke,
      dashed: o.dashed,
      dotted: o.dotted,
      strokeWidth: o.strokeWidth ?? 1,
    }),
    roundness: r.via.length ? null : { type: 2 },
    points: pts,
    lastCommittedPoint: null,
    startBinding: { elementId: fromId, focus: 0, gap: 4 },
    endBinding: { elementId: toId, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  });
  from.boundElements.push({ type: "arrow", id });
  to.boundElements.push({ type: "arrow", id });
  if (label) placeLabel(a, abs, r.via.length > 0, label, o);
  return a;
}

// ═════════════════════════════════ FRAME 1 — start here · the flow · legend · honest claims ═════════════════════════════════
frame("f1", "START HERE — read this strip first; every other frame is the same story in more detail", () => {
  note(
    "t.title",
    20,
    40,
    "THE WINDOW for Stocks — a private overnight lending desk for tokenized stocks, and xONIA, its published rate",
    {
      fontSize: 22,
    },
  );
  note(
    "t.tagline",
    20,
    74,
    "The rate is public. The price is public. The position never was.   ·   Live on Solana devnet · dashboard at https://kaustubh76.github.io/Blinds/",
    { fontSize: 12 },
  );
  let bx = 20;
  for (const s of Object.keys(STATUS)) {
    const b = badge(`t.badge.${s}`, bx, 100, s);
    bx += b.width + 10;
  }
  note(
    "t.badges.note",
    bx + 10,
    101,
    "← every box carries one of these: LIVE = running now (devnet desk, mainnet agent pool) · BUILT · gated = deployed, waiting on an external key · IN PROGRESS = being written today · PLANNED · RETIRED / DROPPED (removed 21 Sep) · ROADMAP (after the hackathon) · CORE = the mechanism itself",
    { fontSize: 11 },
  );
  const r = row(20, 132);
  r.box(
    "t.what",
    1100,
    `WHAT THIS PRODUCT DOES — in plain words
Some people hold tokenized stocks (a Solana token that tracks a real share, e.g. TSLAx tracks Tesla). Some people hold USDC.
THE WINDOW lets the stock holders BORROW USDC overnight against their stock, and the USDC holders LEND it — at ONE interest
rate per round, found by an auction. That rate is published every round as xONIA ("xStocks Overnight Index Average"): the
first on-chain benchmark borrow rate for tokenized equities, like SOFR or SONIA are for dollars and pounds.
The twist: how much anyone lends, borrows or pledges is NEVER visible on chain. Amounts travel as encrypted numbers, the chain
adds them up while still encrypted, and an administrator who CAN decrypt the totals must PROVE every total it publishes.
The loan is safe because the borrower proves — without showing the numbers — that the stock pledged is worth at least 150 %
of the loan at the current price from a public price feed (Pyth). No fresh price → no loan can start and no loan can be seized.
What is public: who took part, at which rate, the round's totals, the rate, the price. What is private: every individual amount.
On devnet the stocks are mock twins, the administrator is one disclosed key, and the auction depth comes from labelled bots.`,
    { ...C.desk, status: "CORE" },
  );
  r.box(
    "t.flow",
    1100,
    `THE FLOW — one round ("epoch", ≈ 7 minutes on devnet), start to finish
 1  JOIN — the admin admits a wallet and gives it mock shares (the /join faucet on the dashboard's Desk).
 2  WRAP — the member turns plain mock shares into their confidential twin, 1:1 (window_wrap). Balances are now hidden.
 3  BID — during an OPEN round a member submits (side, rate tick) in the clear and the SIZE encrypted, with two small proofs
    that the encryption is well-formed and the size is in range. The chain ADDS the encrypted sizes per tick (window_auction).
 4  CLOSE — the keeper bot closes the round on schedule; 74 encrypted totals (2 sides × 37 rate ticks) are frozen.
 5  PRINT — the administrator decrypts each total, proves each decryption on chain (PoCD), and the program itself recomputes
    the clearing rate r* from the proven totals (window_oracle). r* is this round's xONIA.
 6  MATCH — the administrator pairs borrowers with lenders at r* and creates a Loan per pair (window_credit).
 7  LOCK — the borrower proves solvency: encrypted collateral × public price ≥ 150 % × encrypted loan (window_credit).
 8  DEPOSIT — the borrower moves the confidential collateral into the desk's escrow in the same transaction as the check.
 9  FUND · REPAY — the lender sends USDC confidentially; overnight later the borrower repays; the collateral is released.
10  DEFAULT — if the deadline passes unpaid, anyone may seize — but only against a FRESH price — and the lender is paid out.
Meanwhile the KEEPER keeps posting prices, the OPERATOR confirms locks and releases escrow, and anyone can RE-VERIFY every
proof of every round in the browser (Explorer). Rows: actors → lifecycles → programs → cryptography → tracks → services → app.`,
    { ...C.chain, status: "CORE" },
  );
  r.box(
    "t.legend",
    900,
    `HOW TO READ THIS MAP
Colours: green = on chain · slate = other people's programs we call · indigo = the maths ·
grey = the bots and ops · teal = SDK, dashboard, members · violet = Pyth · orange = PreStocks ·
amber = Meteora + Clawpump (LIVE on mainnet, 25 Sep) · sky = xStocks · blue = roadmap · rose = what
is private vs public · dashed grey = RETIRED / DROPPED (Tessera, 21 Sep).
Arrows: 2 px = an instruction that carries a proof · 1 px = a call · dotted = one program only
READS another's account · dashed violet = the Pyth path still waiting on a key · dashed amber =
Part B · dashed grey = retired. Long arrows travel along the empty corridors between frames.
Every box: plain-language heading first, then the technical names, then the file to open.
Frames are chapters, not trust boundaries. Generated by scripts/project_diagram.mjs
(pnpm docs:diagrams); the glossary below explains every term used.`,
    C.desk,
  );
  r.box(
    "t.honest",
    900,
    `HONEST CLAIMS — what this project deliberately does NOT say (SPEC §14)
The administrator CAN decrypt every individual amount. The promise is ACCOUNTABLE privacy:
the public sees totals, the price and the rate, and each is proven or traceable — not blindness.
WHO takes part, at which rate, and when, is public by design.
On devnet one key plays administrator, keeper, operator and price poster.
Escrow sits in the operator's confidential account, not a program's (a technical limit).
How much a lender funded or a borrower repaid is attested by the administrator, not proven.
The stocks are devnet mock twins; the auction depth comes from labelled simulated agents.
xONIA is a devnet reference rate, not a regulated benchmark; this is not a brokerage.
Unaudited · one overnight tenor · never custody real value with it.`,
    C.leak,
  );
  const g = row(20, r.bottom + 40);
  g.box(
    "t.gl1",
    1000,
    `GLOSSARY 1 — the market words
Tokenized stock / xStock — a Solana token that tracks a real share (TSLAx ↔ Tesla). On devnet the desk
  uses "-mock" twins with the same token layout; no real stock is touched.
Pre-IPO token — a token tracking a private company's shares (PreStocks' ANTHROPIC). Same mechanism.
Overnight loan · tenor — borrow USDC for one night; the tenor is the loan's life (≈ 3 rounds on devnet).
Collateral — the stock a borrower pledges. Haircut 150 % = pledge worth at least 1.5 × the loan.
Lock — the moment the borrower proves the pledge is enough. Deposit — moving it into escrow.
Escrow — the desk's holding account for pledged stock. Seize — take the pledge after a missed deadline.
Epoch / window / round — a fixed period in which bids are collected, then cleared once.
Tick — one of 37 interest-rate steps from 1.00 % to 10.00 %, 0.25 % apart. Side — BID (borrow) or ASK (lend).
Sealed bid — the rate and side are public, the size is encrypted.
Clearing · r* — the single rate where the USDC offered meets the USDC wanted; everyone trades at it.
Print — publishing a round's rate together with the proofs. xONIA — that rate, as a time series.
Stale carry — a round with no trade repeats the last rate and flags it stale.
Listing — one collateral's row on the schedule: its price source, haircut and freshness limits.
Fresh / stale price — a quote older than the listing's limit is refused: nothing can lock or seize.
Corporate action / multiplier — a stock split changes the share count; the token records the factor
  and the solvency proof uses it, so a split can neither fake nor destroy solvency.
Keeper — the bot that runs the clock and posts prices. Administrator — decrypts and prints.
Operator — holds escrow and confirms locks. On devnet all three are one key.`,
    C.desk,
  );
  g.box(
    "t.gl2",
    1000,
    `GLOSSARY 2 — the cryptography words (no maths needed)
Ciphertext — a hidden number. Encrypting the same number twice gives different-looking ciphertexts.
ElGamal (twisted, over Ristretto) — the encryption scheme; the same one Solana's Token-2022 uses.
Homomorphic — you can ADD two ciphertexts and get the ciphertext of the sum, without decrypting.
  This is how the chain totals every bid at a tick without seeing any bid.
Grouped ciphertext / two handles — one hidden number readable by two keys: the member's and the auditor's.
Auditor key — the administrator's decryption key; it is stamped on every round.
Zero-knowledge proof (sigma proof) — a short certificate that a statement about hidden numbers is
  true, revealing nothing else. Solana verifies these natively (the ZK ElGamal Proof program).
Validity proof — "this ciphertext is well-formed under these two keys".
Range proof — "this hidden number is between 0 and 2^40" (no negative or absurd sizes).
PoCD — proof of correct decryption: "the total I published is the true decryption of the on-chain sum".
Solvency proof — "hidden collateral × public price ≥ 150 % × hidden loan", built from an equality
  proof and a range proof over E_Δ, the encrypted difference the program computes itself.
BSGS — baby-step giant-step: the administrator's way to turn a decrypted value back into a number.
Commitment / opening — a sealed envelope for a number, and the note that opens it.
Confidential transfer (Token-2022) — Solana's token extension with hidden balances and transfers.
Wrap — converting a plain token into its confidential twin, 1:1.
Inline proof — the proof is the instruction right before the one that needs it. Context-state
  account — a proof verified earlier and parked in an account until a program consumes it.
Leak budget — the list of what is public on purpose; everything else must never appear in plaintext.`,
    C.crypto,
  );
  g.box(
    "t.gl3",
    1000,
    `GLOSSARY 3 — the Solana and tooling words
Program — a smart contract on Solana. Instruction — one function call on a program.
Account / PDA — data lives in accounts; a PDA is an account whose address is derived from seeds
  like ["listing", mint] and owned by a program (written as Name["seed", …] on this map).
CPI — one program calling another. Read — a program only looks at another program's account.
Instructions sysvar — lets a program inspect the other instructions in the same transaction
  (how "the proof must be the previous instruction" is enforced).
Slot — Solana's clock tick (≈ 0.4–0.5 s). Epoch length, grace, deadlines are all in slots.
Anchor — the framework the five programs are written in. IDL — a program's machine-readable
  interface, from which the TypeScript clients are generated.
Oracle / price feed — a service publishing prices on chain. Pyth — the feed used here.
Hermes — Pyth's web API. VAA — a signed price message. Receiver — Pyth's on-chain program that
  checks the signature and stores the price. Push account — where a feed's latest price lives.
Attested mark — a price the keeper copied from a public web API and timestamped itself (PreStocks).
Devnet / localnet / mainnet — the public test network / a validator on your laptop / the real one.
LiteSVM — Solana's runtime run inside a test (tier 1). Tier 2 — the same flows on a real validator.
Faucet — the admin's /join endpoint that admits a wallet and funds it. Burner — a throwaway wallet
  the dashboard creates in the browser so no extension is needed.
DBC — Meteora's Dynamic Bonding Curve: a launch pool whose price follows a curve. Clawpump — a
  service that gives an AI agent an identity, a wallet and a token launch (Part B, LIVE on mainnet).
SDK — the TypeScript library the dashboard and tests use. Explorer — the page that re-verifies prints.`,
    C.tests,
  );
});

const R1 = bottomOf("f1") + ROW_GAP;

// ═════════════════════════════════ FRAME 2 — actors & trust ═════════════════════════════════
frame(
  "f2",
  "WHO IS INVOLVED — docs/THREAT_MODEL.md",
  () => {
    const [c] = colsAt(0, 440, 1, R1);
    c.box(
      "ac.member",
      `MEMBER — a lender (ASK side) or a borrower (BID side)
A person with a wallet, the dashboard's burner wallet, or one
of the desk's simulated agents.
Their decryption key is derived from one wallet signature and
never leaves the browser.
They sign: wrap · submit_bid · lock_collateral ·
deposit_collateral · confidential transfers · unwrap.
They see only their own amounts; everything they claim is
proven. Admission is granted by the admin (the /join faucet).`,
      C.member,
    );
    c.box(
      "ac.admin",
      `ADMINISTRATOR = KEEPER = OPERATOR = PRICE POSTER
One disclosed key on devnet; the four roles are separate in
the program design, not in operations (§14).
Holds the auditor key → can decrypt every individual bid,
loan and balance. ACCOUNTABLE, NOT BLIND: every total it
publishes carries a proof, r* is recomputed on chain, and
every price it posts names its source.
Keeper: open / close rounds, post prices, seize, tidy up.
Administrator: print, pair loans, confirm funding, repay.
Operator: confirm locks, hold escrow, release collateral.
Admin: add or retune listings, rotate the auditor key.
All of it is one binary: services/admin (window-admin).`,
      C.desk,
    );
    c.box(
      "ac.public",
      `PUBLIC / VERIFIER — anyone with a connection to the chain
Sees: encrypted amounts, member keys, sides, ticks, timing,
the proven per-tick totals, r*, matched volume, loan status.
Can: close a round the keeper forgot (after a grace period),
flag a missed print, seize a defaulted loan (with a fresh
price), refund bid rent, and RE-VERIFY every print in the
browser (Explorer) or scan the chain for leaks (leak-audit).`,
      C.public,
    );
    c.box(
      "ac.ext",
      `PROGRAMS WE RELY ON — trusted code, not people
ZK ElGamal Proof program — Solana's native verifier for the
sigma proofs; if it were disabled, prints and loans would
stop safely. Curve syscalls — the arithmetic on ciphertexts.
Token-2022 — confidential balances and transfers, plus the
split multiplier and the issuer clawback on the mock mints.
Pyth receiver (+ Wormhole) — verifies a signed Pyth price
and stores it in an account the program can read (source 4).
System · ATA · Instructions sysvar — account creation and
same-transaction introspection.`,
      { ...C.ext, status: "CORE" },
    );
    c.box(
      "ac.leak",
      `THE LEAK BUDGET — public on purpose vs never visible
PUBLIC: who took part, on which side, at which tick, when;
each tick's total AFTER the print (so a member alone at a tick
is revealed by that total — true of any published depth);
r*, matched volume, the marginal fill ratio; the price and
factor used at lock; a loan's status and deadline; the wrap
amount (wrapping starts from a public balance).
PRIVATE, never in plaintext anywhere — not on chain, not in
logs, not in the bots' output, not in the browser's traffic:
bid sizes, loan sizes, collateral amounts, balances, openings,
the auditor's and members' secret keys.
Enforced by tests: privacy/idl_surface (no instruction takes
a size), privacy/leak_audit (scans everything for plaintext),
and a redaction type in the bots (Secret<u64>).`,
      C.leak,
    );
    c.box(
      "ac.threats",
      `WHAT COULD GO WRONG → the test that proves it cannot
A false published total → attack_01 (the proof fails).
A wrong rate → attack_02 (the program recomputes r*).
A replayed proof → attack_03. A skipped tick → attack_04.
A malformed, dust or duplicate bid → attack_05.
An under-collateralised loan → attack_06 (proof impossible).
A stale or moved price → attack_07. A stock split used to
cheat → attack_08. Wrong or tampered listing → attack_09/10.
A fake Pyth account → attack_11. A faked deposit → the e2e
lifecycle test. Minting wrapped tokens out of thin air → the
invariants suite. A leaked amount → the privacy suite.
Accepted, disclosed risks: the operator holds escrow; funding
amounts are attested; one key; admission is admin-gated;
the issuer of a real xStock can claw tokens back.`,
      C.tests,
    );
    c.box(
      "ac.keys",
      `KEYS — where they come from
Member key: derived from a wallet signature of a fixed
message ("thewindow:member:v1"); a second signature per mint
sets up the confidential token account.
Auditor key: derived from the administrator's secret seed,
which also derives the escrow and the agents' keys.
Each round stamps the auditor key it was sealed under; the
key can only rotate between rounds.
crates/window-elgamal/src/keys.rs · sdk/src/keys.ts`,
      C.crypto,
    );
  },
  { stroke: C.desk.stroke },
);

// ═════════════════════════════════ FRAME 3 — lifecycles ═════════════════════════════════
frame(
  "f3",
  "THE TWO LIFECYCLES — a round · a loan · each arrow = the instruction and who signs it",
  () => {
    const [e, l] = colsAt(540, 400, 2, R1, 80, { gap: 44 });
    e.box(
      "lc.e.h",
      `A ROUND (EPOCH)
37 rate ticks × 2 sides = 74 encrypted running totals.
One bid per member per side per tick per round.
Timing on devnet: a round lasts 900 slots (≈ 7 min); anyone
may close it 450 slots late if the keeper is dead; the print
is due within 2,700 slots of the close.
τ counts rounds since the last real trade; the stale flag
clears after two consecutive trades; a "band edge" flag
warns when r* keeps hitting 1 % or 10 %.`,
      { ...C.chain, align: "center" },
    );
    e.box(
      "lc.e.open",
      `OPEN
open_epoch · keeper · a new Epoch account is created and
stamped with the auditor key.
Members submit sealed bids; the chain adds the encrypted
sizes per tick. The keeper posts every listing's price.`,
      { ...C.chain, align: "center" },
    );
    e.box(
      "lc.e.closed",
      `CLOSED
close_epoch · keeper (anyone, after the grace period)
The 74 totals are frozen. Off chain, the administrator
decrypts each, computes r*, and builds one proof per total.`,
      { ...C.chain, align: "center" },
    );
    e.box(
      "lc.e.printed",
      `PRINTED — this round's xONIA
finalize_print: every non-empty tick has a verified proof,
and the program's own recomputation of r* matches the claim.
The Print account stores r*, matched volume and the
marginal fill ratio; the round is marked printed.
Next: post_match creates the loans; bid rent is refunded.`,
      { ...C.chain, align: "center" },
    );
    e.box(
      "lc.e.notrade",
      `NO TRADE
Supply never met demand → the last rate is carried
forward, flagged stale; the round is still settled.`,
      { ...C.chain, align: "center" },
    );
    e.box(
      "lc.e.missed",
      `MISSED
mark_stale · anyone, once the print deadline passes
→ stale carry, τ + 1; a late print is still allowed, and the
next round opens regardless — the clock never blocks.`,
      { ...C.retired, align: "center" },
    );
    e.box(
      "lc.e.rotate",
      `rotate_auditor · admin · only between rounds
Earlier bids keep the key they were sealed under.`,
      { ...C.desk, align: "center" },
    );

    l.box(
      "lc.l.h",
      `A LOAN
Created by post_match at the printed rate; lives one tenor
(2,700 slots ≈ 3 rounds on devnet); the deadline is set when
the lender funds it.
Its size and collateral stay encrypted for life; only the
price and factor used at lock, and its status, are public.
The dashboard's Desk covers steps up to the bid; Positions
covers lock and deposit; the bots do the rest.`,
      { ...C.chain, align: "center" },
    );
    l.box(
      "lc.l.pending",
      `PENDING
post_match · admin · a full fill copies the bid's ciphertext;
a partial fill gets a fresh ciphertext plus a sealed note so
the borrower can still open it.`,
      { ...C.chain, align: "center" },
    );
    l.box(
      "lc.l.requested",
      `REQUESTED
lock_collateral · borrower · the solvency proof is verified
against a FRESH price; the loan is bound to its listing and
the price and factor used are recorded.`,
      { ...C.chain, align: "center" },
    );
    l.box(
      "lc.l.deposited",
      `DEPOSITED
deposit_collateral · borrower · the instruction just before
it in the same transaction must be the confidential transfer
of the collateral into the desk's escrow.`,
      { ...C.chain, align: "center" },
    );
    l.box(
      "lc.l.locked",
      `LOCKED
confirm_lock · operator · decrypts the collateral with the
auditor key and double-checks the pledge off chain.`,
      { ...C.chain, align: "center" },
    );
    l.box(
      "lc.l.active",
      `ACTIVE
confirm_funding · admin · after the lender's confidential
USDC transfer (its amount is attested, §14).
The repayment deadline is set: now + tenor.`,
      { ...C.chain, align: "center" },
    );
    l.box(
      "lc.l.repaid",
      `REPAID
repay · admin · after the borrower's confidential repayment.`,
      { ...C.chain, align: "center" },
    );
    l.box(
      "lc.l.defaulted",
      `DEFAULTED
seize · ANYONE · only after the deadline AND with a fresh
price — a stale price can never seize.`,
      { ...C.chain, align: "center" },
    );
    l.box(
      "lc.l.released",
      `COLLATERAL RELEASED
release_collateral · operator · the confidential transfer out
of escrow goes to the borrower (repaid) or the lender
(defaulted, who therefore needs an account on that listing).`,
      { ...C.chain, align: "center" },
    );
  },
  { stroke: C.desk.stroke, padRight: 40 },
);

// ═════════════════════════════════ FRAME 4 — the five programs ═════════════════════════════════
const F4X = 1600; // f3 ends at 1460; the 140 px gutter between them is V1
const F4COL = 440;
const F4GAP = 40;
const F4NCOL = 6; // registry · wrap · auction · oracle · credit · credit's collateral schedule
const F4W = 40 + F4NCOL * F4COL + (F4NCOL - 1) * F4GAP;
const F5X = F4X + F4W + 180; // the 180 px gutter between f4 and f5 is V2
let EXT_BOTTOM = 0; // the bottom of the externals row inside f4; the band under it is a corridor
frame(
  "f4",
  "ON CHAIN — the five programs (programs/*/src): what each one is for, what it stores, and every instruction with who signs it",
  () => {
    const xr = row(F4X + 20, R1, { gap: F4GAP });
    xr.box(
      "p.x.sys",
      F4COL,
      `System · ATA · Instructions sysvar
Solana's built-ins: creating accounts (System), the standard
token-account address scheme (ATA), and a way for a program
to look at the other instructions in the same transaction —
which is how "the proof must come right before this call"
and "the transfer must come right before this call" are
enforced (every program's zk.rs).`,
      C.ext,
    );
    xr.box(
      "p.x.token22",
      F4COL,
      `Token-2022 — Solana's token standard with extensions
Mock stock mints carry the split multiplier and an issuer
clawback (like real xStocks). Their confidential twins
(cSTOCK-W) carry hidden balances under the desk's auditor.
Called by window_wrap to move, mint and burn tokens and to
deposit into a hidden balance. Its confidential Transfer is
what borrowers use to move collateral into escrow.`,
      C.ext,
    );
    xr.box(
      "p.x.zk",
      2 * F4COL + F4GAP,
      `ZK ElGamal Proof program — Solana's native proof verifier (the desk verifies nothing itself)
Every proof on this map is checked by this program. The desk's own programs only check the BINDING: that a verified
proof is about the right keys, the right ciphertext, the right round — and do the ciphertext arithmetic through
the curve syscalls.
Two ways a proof reaches it: INLINE — the proof instruction sits right before the instruction that needs it (bid
validity, the PoCD, account setup); or a CONTEXT ACCOUNT — verified in an earlier transaction, parked in an account,
consumed and closed by the program that needs it (the bigger range proofs and the four lock proofs).
crates/window-proofs/src/ix.rs · programs/*/src/zk.rs · docs/adr/ADR-001-proof-delivery.md`,
      { ...C.ext, status: "CORE" },
    );
    xr.box(
      "p.x.pyth",
      F4COL,
      `Pyth receiver — the price, straight from Pyth (source 4)
Pyth's own program verifies a signed price message and stores
it in an account. A listing set to source 4 makes lock and
seize read THAT account: the program checks it is owned by
the receiver, carries the right feed, is fully verified and
fresh. The keeper is out of the price path entirely.
Deployed; the devnet listing flips to it once a Pyth key
exists (the poster needs one). programs/window_credit/quote.rs`,
      { ...C.pyth, status: "BUILT" },
    );

    EXT_BOTTOM = xr.bottom;
    const top = xr.bottom + 130; // the band between the externals and the column heads is a corridor
    const [reg, wrap, auc, orc, cr, sch] = colsAt(F4X, F4COL, F4NCOL, top, F4GAP);

    reg.box(
      "p.reg.h",
      `window_registry — who may take part
The member list: each member's wallet and encryption key.
Admission is admin-gated (on the hosted site, the faucet
does it). The other programs read this list to check a
bidder or borrower is an active member.
programs/window_registry/src/`,
      { ...C.chain, status: "CORE" },
    );
    reg.box(
      "p.reg.acc",
      `STORES
Config["config"] — the admin, a member count.
Member["member", wallet] — the encryption key, when they
joined, active or not (removal keeps the account, flagged).`,
      C.chain,
    );
    reg.box(
      "p.reg.ev",
      `TELLS THE WORLD
MemberAdded · MemberRemoved · MemberKeyUpdated (events)`,
      C.chain,
    );
    reg.box(
      "p.reg.ix",
      `INSTRUCTIONS
initialize · admin
add_member(wallet, encryption key) · admin
remove_member · admin → flagged inactive
update_elgamal_pubkey · the member · earlier bids keep the
  key they were sealed under`,
      C.chain,
    );

    wrap.box(
      "p.wrap.h",
      `window_wrap — plain shares in, confidential shares out
Takes the member's mock stock into a program-owned vault and
mints the confidential twin 1:1 into their hidden balance.
Rule the tests enforce: twins in circulation == shares in
the vault, always. One vault per listed stock.
programs/window_wrap/src/`,
      { ...C.chain, status: "CORE" },
    );
    wrap.box(
      "p.wrap.acc",
      `STORES
Vault["vault", stock mint] — which mints, the custody
account, how much is wrapped.
A mint-authority PDA — the only thing allowed to mint twins.`,
      C.chain,
    );
    wrap.box(
      "p.wrap.ev",
      `TELLS THE WORLD
Wrapped · Unwrapped (events name the member, never an
amount — though the wrap itself is a public token move).`,
      C.chain,
    );
    wrap.box(
      "p.wrap.ix",
      `INSTRUCTIONS
initialize · admin · checks the twin mint is confidential
  with the desk's auditor and the stock mint carries the
  split multiplier
wrap(amount) · member · move shares to the vault, mint the
  twin, deposit it into the member's hidden balance
unwrap(amount) · member · burn the twin, return the shares`,
      C.chain,
    );

    auc.box(
      "p.auc.h",
      `window_auction — the clock and the sealed order book
Runs the rounds and takes the bids. A bid's side and tick are
public; its size is a ciphertext the program ADDS into the
round's running total for that tick, without decrypting.
A round goes Open → Closed → Printed (or No trade).
programs/window_auction/src/`,
      { ...C.chain, status: "CORE" },
    );
    auc.box(
      "p.auc.acc",
      `STORES
Config["config"] — the keeper, the auditor key, round length,
grace period, print deadline, minimum bid.
Epoch["epoch", n] — start and close slots, the auditor key
used, 74 encrypted totals and 74 bid counts, status.
Bid["bid", round, member, side, tick] — one member's
ciphertext (readable by the member and by the auditor).`,
      C.chain,
    );
    auc.box(
      "p.auc.ev",
      `TELLS THE WORLD
EpochOpened · EpochClosed · BidSubmitted (round, member,
side, tick — never a size) · EpochPrinted · AuditorRotated`,
      C.chain,
    );
    auc.box(
      "p.auc.ix",
      `INSTRUCTIONS
initialize · admin
open_epoch · keeper · one round at a time
close_epoch · keeper, or ANYONE after the grace period
submit_bid(side, tick) · member · PROOF-CARRYING:
  a validity proof (inline) under the member's and the
  round's auditor key, a range proof (context account)
  that the size is sane; then the ciphertext is added into
  the tick's total and the Bid account is created
mark_printed · only the oracle program, via CPI
close_bid · anyone, once the round is settled (refunds rent)
rotate_auditor · admin · only between rounds`,
      C.chain,
    );

    orc.box(
      "p.orc.h",
      `window_oracle — turns a closed round into a PROVEN rate
The administrator hands in the decrypted totals and one
proof per total; this program rebuilds what each proof must
say from the frozen on-chain sum, requires every non-empty
tick to be proven, and recomputes the clearing rate ITSELF.
A wrong total, a replayed proof, a skipped tick or a wrong
rate is rejected. It then tells the auction the round is
printed (CPI) and keeps the stale / τ regime.
programs/window_oracle/src/`,
      { ...C.chain, status: "CORE" },
    );
    orc.box(
      "p.orc.acc",
      `STORES
OracleState["oracle"] — the last print (rate, volume),
the stale flag, τ, the band-edge flag, a print count.
Print["print", round] — the claimed totals, r*, matched
volume, the marginal fill ratio, which ticks are non-empty
and which are proven, status.`,
      C.chain,
    );
    orc.box(
      "p.orc.ev",
      `TELLS THE WORLD
PrintBegun · TicksAttested · Printed (rate, volume, stale,
τ) · NoTrade · PrintMissed`,
      C.chain,
    );
    orc.box(
      "p.orc.ix",
      `INSTRUCTIONS
initialize · admin
begin_print(round) · admin · snapshots which ticks are
  non-empty; empty ticks must really be empty
attest_ticks(round, up to 4 totals) · admin · PROOF-CARRYING:
  each total comes with an inline PoCD; the program checks
  the proof is about (on-chain sum − claimed total) under
  the round's auditor key and within the bid-count bound
finalize_print(round, claimed r*) · admin · every non-empty
  tick proven; r* recomputed and compared; the marginal
  fill ratio computed; regime updated; auction told (CPI)
mark_stale(round) · ANYONE, after the deadline · flags the
  miss; a late print stays possible`,
      C.chain,
    );

    cr.box(
      "p.cr.h",
      `window_credit — the loans, and the proof they are safe
Creates a loan per matched pair and walks it through lock →
deposit → funded → repaid or defaulted. The heart is ONE
statement the borrower proves without revealing anything:
E_Δ = (price × factor) × hidden collateral − haircut × hidden
loan ≥ 0. The program forms E_Δ itself from the two
ciphertexts and the public price, so the proof cannot lie.
Reads: the oracle's Print, the auction's Bid, the registry's
Member, the price account, the mint's split factor.
programs/window_credit/src/`,
      { ...C.chain, status: "CORE" },
    );
    cr.box(
      "p.cr.config",
      `STORES — Config["config"], frozen at initialize
The operator, keeper and the three sibling programs; the
loan tenor. Its old single-collateral fields are kept only as
a record — pricing moved to the Listings (right).`,
      C.chain,
    );
    cr.box(
      "p.cr.loan",
      `STORES — Loan["loan", round, borrower, tick, k]
Lender, borrower, the round and rate, status, the fill ratio,
the encrypted loan size, the encrypted collateral, the
commitment to E_Δ, a sealed note for partial fills, the
price and factor used at lock, the deadline, the listing.
Status: Pending → Requested → Deposited → Locked → Active →
Repaid | Defaulted (then "collateral released").`,
      C.chain,
    );
    cr.box(
      "p.cr.ev",
      `TELLS THE WORLD · REFUSES
Events: PricePosted · MatchPosted · LockRequested (price and
factor used, listing) · ListingAdded · LoanStatusChanged ·
CollateralReleased.
Refusals worth knowing: PriceStale / QuoteStale (price too
old), WrongListing, DeltaMismatch (the price moved while the
borrower was proving — the SDK simply proves again),
BadPriceAccount / WrongFeed (a fake Pyth account).`,
      C.chain,
    );
    cr.box(
      "p.cr.ix",
      `INSTRUCTIONS
initialize · admin
add_listing · update_listing · admin · add a collateral to
  the schedule; retune its haircut, limits or source
migrate_loan · admin · resize loans made before listings
post_price(price, time) · keeper · under a listing's feed;
  a time in the future or going backwards is refused
post_match(round, k, full | partial) · admin · pairs a bid
  and an ask at the printed rate → a Pending loan
lock_collateral · borrower · PROOF-CARRYING · reads a fresh
  price, forms E_Δ, checks four proofs (collateral valid and
  in range; E_Δ equals a commitment; that commitment ≥ 0)
deposit_collateral · borrower · the previous instruction
  must be the confidential transfer into escrow
confirm_lock · operator     confirm_funding · admin
repay · admin               seize · ANYONE, after the
  deadline, with a fresh price
release_collateral · operator · after the transfer out of
  escrow to the borrower or the lender`,
      C.chain,
    );

    sch.box(
      "p.cr.sch",
      `THE COLLATERAL SCHEDULE — several stocks, one rate
Each eligible collateral is a Listing with its own price
source, haircut and freshness limits. Which stock a borrower
pledges changes nothing about the auction, the proofs or the
rate — only which price and haircut go into E_Δ.
docs/LISTINGS.md`,
      { ...C.chain, status: "LIVE" },
    );
    sch.box(
      "p.cr.listing",
      `STORES — Listing["listing", twin mint]
The stock mint and its twin, the escrow account, the price
feed id, the price SOURCE, the haircut, the two freshness
limits, a symbol.
Sources: 0 Pyth via the keeper's cache · 1 reserved (the
retired Tessera mark — RETIRED 21 Sep) · 2 PreStocks mark ·
3 mock (local tests) · 4 Pyth's own account, read directly.
Devnet today: TSLAx-mock (Pyth, 150 %, quote ≤ 1 h) ·
ANTHROPIC-mock (PreStocks, 200 %, quote ≤ 48 h) · one
retired listing that refuses everything but repayment.`,
      C.chain,
    );
    sch.box(
      "p.cr.cache",
      `STORES — PriceCache["price", feed id]
The keeper's copy of a price: value, the source's OWN
timestamp (kept unmodified, so its age is public), and the
slot it was posted.
Two freshness rules, checked at lock AND at seize:
① the keeper posted recently enough (the keeper is alive)
② the quote itself is recent enough (the source is alive)
Either fails → nothing happens. Inaction, never a wrong action.`,
      C.chain,
    );
    sch.box(
      "p.cr.quote",
      `quote.rs — where the price is read from
Sources 0–3: this program's own PriceCache for the listing.
Source 4: Pyth's receiver-owned account — must be owned by
Pyth's receiver, carry the listing's feed, be fully verified
and have a positive price; then the same two freshness rules
on Pyth's own timestamps. Seven attack tests cover fakes.
The devnet TSLAx listing still uses source 0 until a Pyth
key exists; the code path is deployed.`,
      { ...C.pyth, status: "BUILT" },
    );
  },
  { stroke: C.chain.stroke },
);

// ═════════════════════════════════ FRAME 5 — cryptography · crates ═════════════════════════════════
frame(
  "f5",
  "THE MATHS, GENTLY — what each proof says (SPEC §7.3, §8) · the crates that implement it",
  () => {
    const [m, k] = colsAt(F5X, 540, 2, R1, 60);
    m.box(
      "cr.elgamal",
      `ENCRYPTION — twisted ElGamal, the scheme Token-2022 uses
A hidden number m becomes a pair of curve points (C, D). C hides m
behind a random r; D lets a key holder strip r away. A GROUPED
ciphertext keeps one C with two D's, so both the member and the
auditor can decrypt the same number.
Why this scheme: it is additive — adding two ciphertexts gives the
ciphertext of the sum, and multiplying one by a public number scales
the hidden number. The whole desk rests on those two facts.
crates/window-elgamal`,
      { ...C.crypto, status: "CORE" },
    );
    m.box(
      "cr.acc",
      `ADDING BIDS WITHOUT SEEING THEM
For each side and tick the Epoch account holds a running total: every
new bid's C is added to it and its auditor D is added alongside.
The result encrypts the SUM of all sizes at that tick — one curve
addition per bid, done by the program itself.`,
      C.crypto,
    );
    m.box(
      "cr.bsgs",
      `DECRYPTING A TOTAL — administrator only
With the auditor key the administrator strips the randomness and is
left with (sum × G), a curve point. Turning that back into the number
is a lookup problem; baby-step giant-step (BSGS) solves it fast
enough for sums up to the bid-count bound. The same trick lets the
operator re-check a collateral amount, and the browser recover a
member's own small values.`,
      C.crypto,
    );
    m.box(
      "cr.pocd",
      `PROOF OF CORRECT DECRYPTION (PoCD) — the print's honesty
Publishing a total is a claim. The proof is that the RESIDUAL —
the on-chain total minus the claimed number — encrypts zero under
the auditor key. That is exactly Solana's built-in "zero ciphertext"
proof. The verifier rebuilds the residual itself from the frozen
total, so the administrator can only supply a number and a proof;
it cannot choose what is being proven. Up to four per transaction.
window-proofs/src/pocd.rs · window_oracle attest_ticks.rs`,
      { ...C.crypto, status: "CORE" },
    );
    m.box(
      "cr.bid",
      `WHAT A BID PROVES
Validity: "this ciphertext is well-formed under my key and this
round's auditor key" — inline, small.
Range: "my size is between the minimum bid and about 1.1 M USDC" —
a bigger proof, verified into a context account first, consumed and
closed by submit_bid. Together they stop poisoned totals and absurd
sizes (attack_05).
window-proofs/src/bid.rs`,
      { ...C.crypto, status: "CORE" },
    );
    m.box(
      "cr.clear",
      `CLEARING — how one rate is found
Walk the ticks from 1 % upward. Supply at r = all USDC offered at
rates ≤ r; demand at r = all USDC wanted at rates ≥ r. The first
rate where supply ≥ demand (> 0) is r*. Every borrower at or above
r* is filled in full; lenders fill in rate order, the last tick
pro-rata (that ratio is published). No such rate → no trade, the
old rate is carried and flagged stale. The oracle recomputes this
on chain; the SDK mirrors it in TypeScript for the Explorer.
crates/window-clearing · sdk/src/rates.ts`,
      { ...C.crypto, status: "CORE" },
    );
    m.box(
      "cr.solv",
      `SOLVENCY — the one new piece of maths
The borrower holds E_c (hidden collateral, in shares) and E_ℓ (hidden
loan, in USDC). The public numbers are the price (in cents), the
split factor, and the haircut.
The PROGRAM forms E_Δ = (price × factor) × E_c − haircut × E_ℓ, using
the additive property — no one decrypts anything.
The borrower proves E_Δ equals a fresh commitment K, and that K is
a non-negative number (a range proof). If the pledge were too small,
Δ would be negative, which wraps to an enormous number and cannot pass.
A split changes the public factor, not the ciphertext, so it can
neither fake nor destroy solvency.
window-proofs/src/solvency.rs · scalar.rs (shared with the program)`,
      { ...C.crypto, status: "CORE" },
    );
    m.box(
      "cr.note",
      `PARTIAL FILLS
When a bid is split across lenders each loan gets a fresh ciphertext;
the borrower needs its opening to prove solvency later, so the
administrator seals it to the borrower with a shared secret derived
from the two keys (an ECDH note) and stores it on the loan.
window-elgamal/src/note.rs`,
      C.crypto,
    );
    m.box(
      "cr.transport",
      `HOW PROOFS TRAVEL (ADR-001)
Small proofs ride inline, right before the instruction that needs
them: the PoCD, bid validity, account setup.
Big proofs go into a context account in an earlier transaction and
are consumed later: range proofs and the four lock proofs.
A full print of 74 non-empty ticks fits in about twenty transactions.
window-proofs/src/ix.rs`,
      C.crypto,
    );

    k.box(
      "cr.c.elgamal",
      `crate window-elgamal
The curve points, ciphertexts and grouped ciphertexts; adding,
scaling and the residual; key derivation from a wallet signature;
BSGS decryption; the sealed notes. One implementation shared by the
programs (through syscalls) and the provers (on a laptop or in the
browser), so both sides compute exactly the same thing.`,
      C.crypto,
    );
    k.box(
      "cr.c.clearing",
      `crate window-clearing
The tick grid, the clearing rule, the pro-rata fill, the bid-count
bound, and the stale / τ / band-edge regime. Pure, no allocation,
so it runs unchanged inside the oracle program, the administrator
bot, the browser verifier and the tests (with shared fixtures).`,
      C.crypto,
    );
    k.box(
      "cr.c.proofs",
      `crate window-proofs
Builds every proof (bid, PoCD, collateral, solvency), packages it for
delivery (inline or context account), and can RE-VERIFY a print or a
loan from raw account bytes. Its unit-scaling module is compiled into
window_credit so the program and the prover agree on every scalar.`,
      C.crypto,
    );
    k.box(
      "cr.c.client",
      `crate window-client
A Rust client without networking: every account address, every
instruction builder, and the Token-2022 confidential-transfer
recipes. Used by the bots and the test harness.`,
      C.crypto,
    );
    k.box(
      "cr.c.config",
      `crate window-config
Reads config/<profile>.toml — round length, tenor, limits, the
collateral schedule — and validates it (a mock price can never hide
behind a real feed id). The bots, the client, the tests and the
Node poster all read the same file.`,
      C.crypto,
    );
    k.box(
      "cr.c.testkit",
      `crate window-testkit
The tier-1 harness: loads the five programs, Token-2022 and the
proof verifier into an in-process Solana runtime and drives whole
rounds and loans with real proofs. One caveat it cannot catch: a
call to a program that is not deployed — tier 2 catches that.`,
      C.crypto,
    );
    k.box(
      "cr.c.wasm",
      `crate window-proofs-wasm → sdk/wasm → the browser
The same provers and verifier compiled to WebAssembly: derive keys
from a signature, build bid and lock proofs, open sealed notes,
re-verify a print, and the confidential-transfer proofs the
dashboard needs. Committed prebuilt, so hosting needs no Rust.`,
      { ...C.crypto, status: "CORE" },
    );
  },
  { stroke: C.crypto.stroke, padRight: 40 },
);

const R2 = bottomOf("f2", "f3", "f4", "f5") + ROW_GAP;

// ═════════════════════════════════ FRAME 8 — tracks & integrations ═════════════════════════════════
frame(
  "f8",
  `TRACKS & INTEGRATIONS — Pyth · PreStocks · xStocks · Tessera (DROPPED 21 Sep) · Meteora DBC + Clawpump (${STATUS[partB.status].label}) — docs/TRACKS.md`,
  () => {
    const [b, py] = colsAt(0, 660, 2, R2); // Pyth on the right: its arrows leave into the V1 gutter
    py.box(
      "tr.py.h",
      `PYTH — the price feed (hackathon track: best use of market data)
Pyth is not decoration here: its price is a coefficient INSIDE every solvency proof and the
gate on every seizure. No fresh Pyth price → no loan can start, no loan can be seized.
The desk's collateral is marked by Pyth's 24/7 feed for the TSLAx wrapper, and shown next to
the underlying Tesla equity feed with the difference between them — the overnight window
opens exactly when the stock market closes, which is why the wrapper feed is the mark.
Honest record: Pyth's web API has needed a paid key since late August, and the feed's only
public on-chain account stopped updating on 12 Sep; until a key exists the chain REFUSES
TSLAx loans as "quote stale" rather than pricing them off a dead number. docs/PYTH.md`,
      { ...C.pyth, status: "LIVE" },
    );
    py.box(
      "tr.py.hermes",
      `Pyth Hermes — Pyth's web API (needs PYTH_API_KEY, used only by the bots)
Returns the latest price with the publisher's own timestamp, and the signed message the poster
forwards to Pyth's on-chain receiver. Without a key the keeper falls back to reading Pyth's
existing on-chain price accounts (the freshest of them, owner and feed checked); the browser
reads the same accounts through a public RPC.`,
      C.pyth,
    );
    py.box(
      "tr.py.s1",
      `① Keeper freshness — the keeper posts the source's OWN timestamp, unmodified
So the age of every quote is public, and the chain — not the keeper — decides whether it is
usable. A price-check command and a metric show every listing's source and quote age.
services/admin/src/price.rs`,
      { ...C.pyth, status: "LIVE" },
    );
    py.box(
      "tr.py.s2",
      `② Dashboard panel — wrapper vs underlying
The Market page shows the TSLAx quote beside the Tesla equity quote read straight from Pyth's
accounts in the browser, the gap between them, and whether the stock market is open.
app/src/lib/pyth.ts · CollateralMark.tsx · the pyth-mainnet recipe on the Build page`,
      { ...C.pyth, status: "LIVE" },
    );
    py.box(
      "tr.py.s3",
      `③ Listing upgrade — one rate, a schedule of collaterals
window_credit gained Listings (per-collateral source, haircut, freshness limits), an on-chain
"quote too old" rule, and a migration for the loans that predated it. Covered by attack tests
and a tier-2 lifecycle on a second listing.`,
      { ...C.pyth, status: "LIVE" },
    );
    py.box(
      "tr.py.s4",
      `④ Pyth's own account on chain — the keeper leaves the price path
A listing on source 4 makes lock and seize read the account Pyth's receiver wrote: the price
Pyth's guardians signed, verified by Pyth's program, never copied by anyone. A small Node
poster (services/pyth-poster) forwards Hermes' signed message onto devnet every minute.
The program side is deployed; flipping the devnet listing waits for a Pyth key.`,
      { ...C.pyth, status: "BUILT" },
    );

    b.box(
      "tr.ps.h",
      `PRESTOCKS — a pre-IPO token as collateral (hackathon track)
PreStocks' ANTHROPIC token (a claim on private Anthropic shares) is listed next to the tokenized
stock under the SAME rate: wrap the mock twin, prove collateral ≥ 200 % × loan against
PreStocks' published mark, borrow at the print. It is the only pre-IPO token on the desk,
because PreStocks' rules exclude projects that also integrate a competitor's tokens.
Verified end to end on the hosted site by a fresh wallet (18–20 Sep).`,
      { ...C.prestocks, status: "LIVE" },
    );
    b.box(
      "tr.ps.api",
      `PreStocks public API — an ATTESTED mark, not a signed feed
The keeper fetches the published mark price from PreStocks' web API and posts it with the
FETCH time as its timestamp; the chain, the config and the dashboard all label it "attested".
The 48-hour freshness limit is therefore a promise that the keeper keeps fetching; if the API
dies the last mark is re-posted for a few hours, then the rule halts new locks on that listing.`,
      C.prestocks,
    );
    b.box(
      "tr.xs.h",
      `xSTOCKS — the tokenized-stock family the desk is built for (devnet twins)
The "-mock" mints copy the real xStocks' token layout — the split multiplier the solvency proof
reads, and the issuer's clawback power (an accepted risk, true of the real thing). window_wrap
turns them into confidential twins. No real xStock, pre-IPO token or PreStocks token is touched.`,
      { ...C.xstocks, status: "LIVE" },
    );
    b.box(
      "tr.xs.wrap",
      `Real xStocks wrapping — the first thing after the hackathon (SPEC §23)
Point window_wrap at the real mainnet xStocks mints; the program logic does not change, but
real custody and an external audit come first. Later, real USDC's confidential extension
replaces the wrapped USDC leg.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    b.box(
      "tr.ts.h",
      `TESSERA — pre-IPO T-Tokens — DROPPED 21 Sep
Tessera's T-OpenAI token was listed and verified end to end (17–20 Sep) with the same mechanism.
PreStocks' rule "projects that integrate any non-PreStocks pre-IPO tokens are ineligible" meant
the desk could not hold both; Tessera was removed from the config, the bots, the SDK, the
dashboard and the tracks diagram.`,
      { ...C.retired, status: "DROPPED" },
    );
    b.box(
      "tr.ts.listing",
      `The T-OpenAI-mock listing — RETIRED on chain (a Listing cannot be deleted)
The admin retuned it to an impossible haircut and a one-second quote limit, and renamed it
RETIRED: every future lock and seize is refused, while repayment and release (which need no
price) still work, so its open loans settle. The dashboard shows it as "retired".`,
      { ...C.retired, status: "RETIRED" },
    );
    b.box(
      "tr.mc.h",
      `METEORA DBC + CLAWPUMP — "the lender agent" (Part B, decided 21 Sep)
THE WINDOW's lender is already an autonomous agent: it lends USDC every round and earns xONIA on
stock-collateralised loans. Part B gave that agent a Clawpump identity and wallet and launched
its own token on a Meteora Dynamic Bonding Curve pool on MAINNET, quoted in TSLAx and configured
from the desk's own numbers. Honest framing: the pool and its fees are real; the lending loop
behind it is the devnet desk.
${partB.line}`,
      { ...C.meteora, status: partB.status },
    );
    b.box(
      "tr.mc.plan",
      `The pool is configured from the desk (services/launch/src/plan.ts)
The raise target is the agent's lending capital, converted to TSLAx through the same Pyth read
the desk uses; the fee claimer is the agent's wallet\nand the creator keeps nothing; the trading fee decays over one overnight window (the desk's tenor); the creator
fee stream is the agent's wallet; on graduation the pool migrates to a regular Meteora pool.
xStocks are approved as quote tokens on Meteora; pre-IPO tokens are not, which is why the pool is
quoted in TSLAx.`,
      { ...C.meteora, status: partB.status },
    );
    b.box(
      "tr.mc.code",
      `The code: services/launch (plan · launch · status · buy · graduate · agent) · sdk/src/dbc.ts (reads
the pool from the browser) · a lender-agent card on the Market page · a launch-status recipe on
the Build page · the Meteora and Clawpump sections of docs/TRACKS.md.
Needs from the user: a Clawpump API key and about half a SOL on mainnet for the launch wallet.
${partB.line}`,
      { ...C.meteora, status: partB.status },
    );
  },
  { stroke: C.meteora.stroke },
);

// ═════════════════════════════════ FRAME 6 — services ═════════════════════════════════
frame(
  "f6",
  "THE BOTS — services/admin is one binary playing administrator, keeper, operator and price poster (one key); plus the simulated members, the Pyth poster and the launch tool",
  () => {
    const [c1, c2, c3, c4, c5, c6] = colsAt(F4X, F4COL, F4NCOL, R2, F4GAP);
    c1.box(
      "sv.setup",
      `SETUP — window-admin setup
Creates the mock stock mints and their confidential twins,
initialises the five programs, creates the escrow, adds every
listing from the config, admits the simulated agents and
funds them, and writes deployments/<cluster>.json — the
"descriptor" every other tool and the dashboard read.
Later: listings-sync and migrate-loans bring an existing
deployment up to a new schedule. services/admin/src/setup.rs`,
      C.desk,
    );
    c1.box(
      "sv.price",
      `PRICE SOURCES — one per listing (price.rs)
Pyth: Hermes with a key, else the freshest of Pyth's own
on-chain accounts (owner and feed checked).
PreStocks: the published mark from its web API, stamped with
the fetch time (attested); the last good mark is kept for a
few hours if the API fails.
Mock: a gentle random walk for local tests.
Source 4: the keeper posts nothing; the program reads Pyth.
price-check prints every listing's source, mark and age.`,
      C.desk,
    );
    c1.box(
      "sv.env",
      `CONFIGURATION
Cluster, profile (config/*.toml), RPC endpoint, the admin
keypair and the auditor seed; the Pyth key; the faucet's
limits (wallets per hour, minimum balance, funding per
wallet). The run loop ticks every few seconds.
services/admin/src/main.rs · .env.example`,
      C.desk,
    );
    c1.box(
      "sv.modules",
      `THE MODULES — services/admin/src
keeper · administrator · operator · agents · price · quote
(freshness pre-checks) · setup · deployment · faucet ·
metrics (the HTTP API) · matching · migrate · secret (a
wrapper that prints [redacted] so no decrypted value can
ever reach a log) · zkprobe (a validator self-test).`,
      C.desk,
    );
    c1.box(
      "sv.http",
      `THE HTTP API — what the dashboard talks to
GET /healthz · GET /metrics (counters: rounds, prints, loans,
prices, quote ages) · GET /deployment (the descriptor) ·
GET /faucet (how many joins are left this hour) ·
POST /join — the faucet: admits a wallet, mints it shares of
every listed stock and sends it a little SOL, once per
wallet, rate-limited, refused when the admin runs low.
Reached from the hosted site through a temporary tunnel
(the ?admin= link the market script prints).`,
      C.desk,
    );

    c2.box(
      "sv.agents",
      `SIMULATED MEMBERS — window-admin agents
Six bots (three lenders, three borrowers) so the auction has
depth to print; labelled "simulated" everywhere.
Each round they bid around the last printed rate — lenders
ask a little below it, borrowers bid a little above — so the
rate drifts back toward a resting level instead of ratcheting.
Borrowers take turns serving their loans: lock (with the
proofs), then deposit into escrow; anything stranded by a
price move or a failure is resumed next round.
Every agent keeps a confidential account on every listing so
a default can pay a lender in that listing's stock.`,
      C.desk,
    );
    c2.box(
      "sv.cli",
      `COMMANDS — window-admin …
setup · run · agents · price-check · listings-sync ·
migrate-loans · listing-set-source (flip a listing to Pyth's
account, only after reading it fresh) · listing-retire (how
Tessera's listing was retired — RETIRED) · zk-probe (does this
machine's validator accept the proofs? — a known trap).`,
      C.desk,
    );
    c2.box(
      "sv.tunnels",
      `OPERATIONS — scripts/
market.sh start | stop | status | tunnel — runs the bots and
the poster, opens the tunnel for the faucet, prints the
share link for the hosted dashboard.
watch_tunnels.sh keeps the tunnels alive; serve_app.sh
serves the app itself if hosting is down; localnet.sh runs
everything on a laptop; deploy / upgrade scripts for devnet;
freeze.sh makes the programs immutable — irreversible, the
very last step, only on the user's go.`,
      C.desk,
    );

    c3.box(
      "sv.keeper",
      `THE KEEPER LOOP — keeper.rs, every tick
No round open → open one and post every listing's price.
Round past its length → close it.
Repost a listing's price when its cache is half-way to
stale (a dead source is posted with its true, old
timestamp — the chain will refuse it).
Seize any loan past its deadline (with that listing's price).
Refund bid rent once a round has settled.`,
      C.desk,
    );
    c3.box(
      "sv.matching",
      `MATCHING — matching.rs, after each print
Decrypt every bid with the auditor key, fill borrowers at or
above r* in full, lenders in rate order with the last tick
pro-rata, and pair them greedily: a lender covering a whole
bid gives a "full" loan; a bid split across lenders gives
"partial" loans with fresh ciphertexts.`,
      C.desk,
    );

    c4.box(
      "sv.administrator",
      `THE ADMINISTRATOR LOOP — administrator.rs
A closed round → decrypt the 74 totals (BSGS), compute r*,
then send: begin_print, batches of attest_ticks each with
its PoCDs inline, finalize_print with the claimed rate.
A printed round → run matching and post_match per pair.
Then the demo policy: confirm funding for locked loans,
repay most loans half-way through their tenor, and leave
every fourth one to default so judges see a seizure.
Never logs a decrypted number.`,
      C.desk,
    );

    c5.box(
      "sv.operator",
      `THE OPERATOR LOOP — operator.rs
A deposited loan → decrypt the collateral, re-check the
pledge, confirm_lock.
A repaid or defaulted loan → build the confidential transfer
out of escrow to the borrower or the lender, send it together
with release_collateral. Failures are remembered and retried
quietly. The escrow is the operator's own confidential
account, one per listing (§14).`,
      C.desk,
    );

    c6.box(
      "sv.poster",
      `services/pyth-poster — Node
Once a minute: fetch the signed price message from Hermes
(needs the key) and hand it to Pyth's receiver on devnet,
which verifies it and stores the price in the account that
a source-4 listing reads. Started by market.sh when a key is
present; then the admin flips the TSLAx listing to source 4.`,
      { ...C.pyth, status: "BUILT" },
    );
    c6.box(
      "sv.launch",
      `services/launch — Node (Part B)
plan: read TSLAx/USD from Pyth, size the pool from the
agent's capital, write the launch plan.
launch: create the pool (and the token) on devnet or mainnet.
status · buy · graduate: watch, test-trade, migrate.
agent: create the Clawpump agent and its wallet.
${partB.line}`,
      { ...C.meteora, status: partB.status },
    );
  },
  { stroke: C.desk.stroke },
);

// ═════════════════════════════════ FRAME 7 — SDK · dashboard ═════════════════════════════════
frame(
  "f7",
  "THE SDK AND THE DASHBOARD — sdk/src · app/src: what a member, a judge or a developer touches",
  () => {
    const [s, a] = colsAt(F5X, 540, 2, R2, 60);
    s.box(
      "sd.sdk.zk",
      `Proofs in the browser — sdk/src/zk.ts · wasm.ts
Encodes the proof-verifier's instructions (inline or into a context
account) and lazily loads the WebAssembly provers when first needed.`,
      C.app,
    );
    s.box(
      "sd.sdk.tx",
      `Transaction plans — sdk/src/tx.ts
Every member action as a ready plan of transactions:
onboard (create the confidential token account, one proof) ·
wrap (plus applying the pending balance) · bid (three transactions:
park the range proof, then the inline validity proof + submit_bid) ·
lock (four proofs, then lock_collateral) · deposit (the confidential
transfer + deposit_collateral in one transaction).
send.ts sends them with retries and readable errors; every send is
mirrored into the dashboard's console.`,
      { ...C.app, status: "CORE" },
    );
    s.box(
      "sd.sdk.lock",
      `lockCollateral — sdk/src/lock.ts
Reads the price from wherever the PROGRAM will read it, builds the
proofs, sends; if the keeper reposted the price meanwhile (the
program answers DeltaMismatch) it cleans up and proves once more.`,
      C.app,
    );
    s.box(
      "sd.sdk.solv",
      `Numbers — sdk/src/solvency.ts · rates.ts
The scalar recipe (price in cents × factor; haircut) and "how much
must I pledge for this loan"; the tick grid and the clearing rule
mirrored from the Rust crate for the Explorer.`,
      C.app,
    );
    s.box(
      "sd.sdk.accounts",
      `Reading the chain — sdk/src/accounts.ts · listings.ts · pyth.ts
Fetch any account of the five programs; fetch every listing's quote
in one call from the account the program reads (cache or Pyth); the
freshness verdict; the xONIA series; the depth curve of a print;
a member's loans and bids; confidential balances and the split factor.`,
      C.app,
    );
    s.box(
      "sd.sdk.verify",
      `verifyPrint — sdk/src/verify.ts — trust nothing, check it yourself
Downloads the round and its print, finds the transactions that carried
the PoCDs, re-verifies every proof in WebAssembly against the frozen
totals, recomputes r* and the matched volume, and reports what matched.
Used by the Explorer's Re-verify button and by the tests.`,
      { ...C.app, status: "CORE" },
    );
    s.box(
      "sd.sdk.keys",
      `Keys and addresses — sdk/src/keys.ts · pda.ts · programs.ts
The signing messages that derive a member's keys, every account
address (PDA) of the five programs, and the program ids.`,
      C.app,
    );
    s.box(
      "sd.sdk.gen",
      `Generated clients — sdk/src/generated/*
Typed instruction builders, account and event decoders for each
program, generated from the programs' IDLs (a drift check in CI
keeps them in sync).`,
      C.app,
    );
    s.box(
      "sd.sdk.dbc",
      `sdk/src/dbc.ts — reading the lender agent's Meteora pool (Part B)
Decodes the pool and its config from raw bytes so the dashboard can
show progress to graduation, price and fees without a second library.
${partB.line}`,
      { ...C.meteora, status: partB.status },
    );

    a.box(
      "sd.app.home",
      `#/home — the front door
The window clock (where the current round is), the latest xONIA and
recent prints, each listed stock with its mark and whether the chain
would accept it right now, a borrow calculator, and "Try it", which
makes a burner wallet and sends you to the Desk.`,
      C.app,
    );
    a.box(
      "sd.app.desk",
      `#/desk — the judge path, five guided steps (about 20 seconds)
① Derive your keys (two signatures) · ② Join the desk (the faucet)
③ Set up your confidential account · ④ Wrap shares · ⑤ Seal a bid.
Autopilot runs all five, waits for an open round and bids slightly
past the last print so it clears. Works with a burner or any wallet.
Desk.tsx · useDesk.ts`,
      { ...C.app, status: "CORE" },
    );
    a.box(
      "sd.app.positions",
      `#/positions — your loans
Each loan with its lifecycle track; Lock (the proofs are built here,
from the bid's saved opening or the sealed note) and Deposit into
that loan's escrow; a button to open an account on another listing
so a default can pay you. Reads the chain only.`,
      C.app,
    );
    a.box(
      "sd.app.market",
      `#/market — the benchmark
xONIA over time, the last round's depth curve, the Pyth wrapper-vs-
underlying panel, the collateral schedule with every listing's quote
age and verdict, and the programs' events as they happen.`,
      C.app,
    );
    a.box(
      "sd.app.explorer",
      `#/explorer — one round, as the chain holds it
The 74 sealed totals, the proven sums, the clearing, and the
Re-verify button that re-runs every proof in your browser and
compares its own r* with the chain's.`,
      { ...C.app, status: "CORE" },
    );
    a.box(
      "sd.app.build",
      `#/build — for developers
The live collateral schedule with addresses and verdicts; recipes that
run in the tab and copy as code (read the market, the last print,
verify it, your position, a dry-run bid, subscribe to events, …);
the five programs' instructions, accounts, events and errors; the
admin API; the two track columns; links to the docs and this map.`,
      C.app,
    );
    a.box(
      "sd.app.console",
      `Console · live events · burner · session
A developer console (backtick key) logs every SDK call as copyable
code and every transaction — never a signature or a bid opening.
A WebSocket layer follows all five programs and decodes their
events. The burner is a throwaway wallet kept in the browser; the
session keeps your derived keys in memory only.
window.thewindow exposes the SDK and client in DevTools.`,
      C.app,
    );
    a.box(
      "sd.app.hosting",
      `Hosting
GitHub Pages on every push to main (no Rust needed — the WebAssembly
is committed). Vercel also works. Reading the market needs no
service at all; joining and trading need the faucet, reached through
the tunnel link (?admin=…) or a committed pointer file.`,
      C.app,
    );
    a.box(
      "sd.app.shell",
      `Settings and plumbing — config.ts · chain.ts · queries.ts
?rpc= ?ws= ?admin= on any link (remembered), or the settings sheet;
the deployment descriptor comes from the service if reachable, else
the bundled copy, so the read-only pages always work. Polls every
few seconds; light and dark themes. Vite · React · Tailwind.`,
      C.app,
    );
  },
  { stroke: C.app.stroke },
);

const R3 = bottomOf("f8", "f6", "f7") + ROW_GAP;

// ═════════════════════════════════ FRAME 9 — tests · CI · ops ═════════════════════════════════
frame(
  "f9",
  "HOW IT IS TESTED AND RUN — tests/ (tier 1) · tests/integration (tier 2) · CI · config profiles · deployments · scripts",
  () => {
    const [c1, c2, c3, c4] = colsAt(0, 440, 4, R3, 40);
    c1.box(
      "ts.t1.h",
      `TIER 1 — tests/ on LiteSVM
Solana's real runtime and real proof verifier, run inside the
test process with the five compiled programs: fast, exact,
and every proof is real. cargo test --workspace.
Suites: e2e · attacks · invariants · privacy · measurements
— all green at HEAD.`,
      { ...C.tests, status: "CORE" },
    );
    c1.box(
      "ts.t1.e2e",
      `e2e — the happy paths
A full round with five members, bids → print → re-verify.
A full loan: wrap → bid → print → match → lock → deposit →
confirm → fund → repay → release → unwrap; the default and
seize path; a second listing; a legacy-loan migration.`,
      C.tests,
    );
    c1.box(
      "ts.t1.attacks",
      `attacks — 32 things that must be REJECTED
False total · wrong rate · replayed proof · skipped tick ·
malformed / dust / duplicate bids · under-collateralised
loan · stale or moved price · stock-split trick · wrong
listing · listing tampering · fake Pyth account.`,
      C.tests,
    );
    c1.box(
      "ts.t1.inv",
      `invariants — random walks through the state machine
Collateral is conserved; wrapped twins equal vault shares;
deadlines are safe; no loan ends twice; matched volume never
exceeds supply or demand; rounds only move forward.`,
      C.tests,
    );
    c1.box(
      "ts.t1.privacy",
      `privacy — the leak budget, enforced
No instruction of any program takes an amount (an allow-list
of numeric fields), and a scan of every account, transaction
and log after a full round and two loans finds no secret in
plaintext. Repeated over RPC in tier 2 and on devnet.`,
      C.tests,
    );
    c1.box(
      "ts.t1.meas",
      `measurements — the numbers in the README
The original go / no-go gate (a decrypted sum with a true
proof passes, a false one fails), and the cost of a print at
1, 10, 37 and 74 non-empty ticks, kept in sync with the
README by a CI check.`,
      C.tests,
    );

    c2.box(
      "ts.t2.h",
      `TIER 2 — tests/integration on a real validator
A local solana-test-validator with the real bots and the
dashboard's own code path, driven through the TypeScript
SDK: the thing tier 1 cannot see (a missing program, a real
network) shows up here. make test-integration.`,
      { ...C.tests, status: "CORE" },
    );
    c2.box(
      "ts.t2.suites",
      `desk — the judge path end to end plus a leak audit over RPC
· partial_fill — a bid split across lenders · second_listing
— lock and deposit on another collateral.`,
      C.tests,
    );
    c2.box(
      "ts.ci",
      `CI — .github/workflows
ci.yml: format and lint · build the programs and run tier 1 ·
build the SDK and app, run the unit tests, check the generated
docs (measurements, this diagram) · tier 2 · doc rules
(honest claims, lineage). tier2.yml: on demand, with a
validator built from source (the prebuilt Linux one rejects
valid proofs — a documented trap). pages.yml: publishes the
dashboard on every push to main.`,
      C.tests,
    );

    c3.box(
      "ts.make",
      `Makefile · package.json — the entry points
make build · test · test-integration · demo (one full round
on a laptop, then re-verified) · deploy-devnet · freeze ·
size (the programs' rent budget).
pnpm build · test · codegen · docs:diagrams · watch:epoch ·
schedule · leak-audit.`,
      C.tests,
    );
    c3.box(
      "ts.profiles",
      `PROFILES — config/*.toml, frozen into the programs at setup
demo (fast rounds on a laptop) · integration (very fast, for
tier 2) · devnet (≈ 7-minute rounds, ≈ 3-round loans) · prod
(hour-long rounds, six-hour loans).
Each sets the round length, grace, print deadline, price
freshness, the haircut, the proof batch size — and the
collateral schedule ([[listings]]).`,
      C.tests,
    );
    c3.box(
      "ts.deploy",
      `DEPLOYMENTS — deployments/<cluster>.json
The descriptor: program ids, mints, escrow, the auditor's
public key, every listing's accounts and limits, the agents.
The dashboard bundles the devnet one so read-only pages work
without any service. render_devnet_docs.py copies the
addresses into docs/DEMO.md and the README.`,
      C.tests,
    );

    c4.box(
      "ts.scripts",
      `scripts/ — the small tools
check_claims (the §14 rule, also over this file) ·
check_lineage · sync_idl · build_wasm · leak_audit (attack a
live cluster's history for secrets) · watch_epoch (wait for
prints and re-verify them) · schedule (the collateral
schedule with verdicts) · measurements_to_md ·
tracks_diagram and project_diagram (this map).`,
      C.tests,
    );
    c4.box(
      "ts.runbook",
      `RUNBOOK — docs/RUNBOOK.md · docs/toolchain.md
Pinned toolchain (Rust, Solana, Anchor, Node, the proof
library version that matters). Running costs a fraction of a
SOL per hour on devnet. Start / watch / stop with market.sh;
replace a dead tunnel; serve the app yourself if Pages is
down. Known traps: the prebuilt Linux validator; a public RPC
that rate-limits browsers. Never deploy from an automated
session; freezing is irreversible and only on the user's go.`,
      C.tests,
    );
  },
  { stroke: C.tests.stroke },
);

// ═════════════════════════════════ FRAME 10 — roadmap · limits · amendments ═════════════════════════════════
frame(
  "f10",
  "WHAT COMES NEXT, AND WHAT CHANGED ALONG THE WAY — SPEC §23 · §14 · the amendments · docs/BUILD_PLAN.md",
  () => {
    const [c1, c2, c3] = colsAt(1980, 520, 3, R3);
    c1.box(
      "rm.s23.wrap",
      `Real xStocks wrapping — first
Point window_wrap at the real mainnet mints; the logic is
unchanged, the custody and audit questions are new.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    c1.box(
      "rm.s23.funding",
      `Proven funding and repayment amounts
Today the administrator attests how much a lender sent or a
borrower repaid. A proof that the confidential transfer's
amount equals the loan's amount closes that gap.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    c1.box(
      "rm.s23.threshold",
      `A threshold administrator
Split the auditor key across several parties so no single one
can decrypt; the scheme used here supports it without new
circuits.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    c1.box(
      "rm.s23.anon",
      `Anonymous membership
Hide WHO takes part, not just how much — the one extension
that needs a real circuit and a trusted setup.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    c1.box(
      "rm.status",
      `WHERE THE BUILD STANDS — 25 Sep 2026 (deadline Fri 26 Sep)
Every phase of the build plan is done: the primitives and the
gate, the print, priced credit, the bots and devnet, the
dashboard (hosted on Pages and Vercel, both verified).
Every track stage is done; flipping TSLAx to Pyth's own account
waits for a Pyth key; freezing the programs waits for the user.
Tessera retired (DROPPED / RETIRED). Part B — Meteora + Clawpump
(${STATUS[partB.status].label}): the pool and the identity coin
are on mainnet, and the agent's wallet claims every fee.`,
      C.desk,
    );

    c2.box(
      "rm.s23.tenors",
      `Term tenors and a curve
Several books running side by side: xONIA one-day, seven-day…
Today: one overnight tenor.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    c2.box(
      "rm.s23.margin",
      `Margin calls inside the tenor
A top-up instruction using the same solvency proof, partial
seizure, and haircuts calibrated per stock from recorded
volatility. Today: a fixed haircut and a deadline.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    c2.box(
      "rm.s23.usdc",
      `Prices on chain · real USDC
Reading Pyth's own account is already built (source 4), gated
on a key. When Circle enables USDC's confidential extension,
the wrapped USDC leg disappears.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    c2.box(
      "rm.s23.mainnet",
      `Mainnet, and the research question
Mainnet only after an external audit. The behavioural study
the spec was written for — does a private auction change how
people bid, versus a transparent or a merely attested one —
is deferred, and said so.`,
      { ...C.roadmap, status: "ROADMAP" },
    );
    c2.box(
      "rm.s14",
      `HONEST LIMITATIONS — SPEC §14, the short list
The administrator can decrypt individual amounts · who takes
part is public · mock collateral · marks copied by the keeper
except on source 4 · no margin calls, an illustrative haircut ·
funding amounts attested · escrow held by the operator · one
key for four roles · simulated members · not a regulated
benchmark or a broker · depends on Solana's proof program ·
unaudited, single tenor, no real value.`,
      C.leak,
    );

    c3.box(
      "rm.amend",
      `WHAT CHANGED WHILE BUILDING — the amendments (SPEC_AMENDMENTS.md)
The print is batched into begin / attest / finalize because
proofs must fit in transactions (A1). One account per bid (A2).
Units fixed to milli-shares, cents and a milli-factor (A3).
Wrapping needs no proof (A4); a deposit is checked by looking
at the transfer beside it (A5). Full fills reuse the bid's
ciphertext (A6). The split factor is read from the token (A7).
A newer proof library was required after a transcript change
(A10). The price moved from a keyed web API to Pyth's on-chain
account (A11), then gained an on-chain "quote too old" rule
(A13), then a schedule of several collaterals (A14), then a
listing that reads Pyth's account directly (A15). Program size
is budgeted because rent is paid forever (A12).`,
      C.desk,
    );
    c3.box(
      "rm.docs",
      `THE WRITTEN RECORD — docs/
SPEC.md (frozen) · SPEC_AMENDMENTS.md · METHODOLOGY.md (the
leak budget) · THREAT_MODEL.md · TRACKS.md (the integration
record) · PYTH.md · LISTINGS.md · DEMO.md (addresses and a
walkthrough) · RUNBOOK.md (judging day) · toolchain.md ·
adr/ (three design decisions) · tracks.excalidraw ·
project.excalidraw (this map)`,
      C.desk,
    );
  },
  { stroke: C.roadmap.stroke },
);

// ═════════════════════════════════ ARROWS ═════════════════════════════════
// Lanes are planned so that two runs never share a lane over the same x-range; see the corridor comment above.
const T = { strokeWidth: 2 };
const READ = { dotted: true };
const VIO = { stroke: C.pyth.stroke, dashed: true };
const AMB = { stroke: C.meteora.stroke, dashed: true };
const GREY = { stroke: C.retired.stroke, dashed: true };
const chainC = { stroke: C.chain.stroke };
const V1 = (F.f3.x + F.f3.width + F.f4.x) / 2; // gutter f3 | f4, also f8 | f6
const V2 = (F.f4.x + F.f4.width + F.f5.x) / 2; // gutter f4 | f5, also f6 | f7
const BAND = (lane = 0) => EXT_BOTTOM + 16 + 16 * lane; // inside f4, between the externals row and the column heads

// lifecycles — bypass runs use the 80 px gap between the two columns (four lanes, 16 px apart)
const eRight = need("lc.e.h").x + need("lc.e.h").width;
const lRight0 = need("lc.l.h").x; // the loan column's left edge
arrow("lc.e.open", "lc.e.closed", "close_epoch · keeper (anyone after grace)", chainC);
arrow("lc.e.closed", "lc.e.printed", "begin_print → attest_ticks → finalize_print · admin", { ...chainC, ...T });
arrow("lc.e.closed", "lc.e.notrade", null, { ...chainC, route: { kind: "V", x: eRight + 16 } });
arrow("lc.e.closed", "lc.e.missed", null, { ...GREY, route: { kind: "V", x: eRight + 32 } });
arrow("lc.e.printed", "lc.e.open", null, { ...chainC, route: { kind: "V", x: eRight + 48 } });
arrow("lc.e.rotate", "lc.e.open", null, { ...READ, route: { kind: "V", x: eRight + 64 } });
arrow("lc.e.printed", "lc.l.pending", "post_match · admin · Full | Partial", {
  ...chainC,
  route: { kind: "V", x: lRight0 - 8 },
});
arrow("lc.l.pending", "lc.l.requested", "lock_collateral · borrower · 4 proofs", { ...chainC, ...T });
arrow("lc.l.requested", "lc.l.deposited", "deposit_collateral · CT Transfer at ix −1", chainC);
arrow("lc.l.deposited", "lc.l.locked", "confirm_lock · operator · BSGS re-check", chainC);
arrow("lc.l.locked", "lc.l.active", "confirm_funding · admin · deadline = now + tenor", chainC);
arrow("lc.l.active", "lc.l.repaid", "repay · admin", chainC);
const lRight = need("lc.l.h").x + need("lc.l.h").width;
arrow("lc.l.active", "lc.l.defaulted", null, { ...chainC, route: { kind: "V", x: lRight + 16 } });
arrow("lc.l.repaid", "lc.l.released", null, { ...chainC, route: { kind: "V", x: lRight + 32 } });
arrow("lc.l.defaulted", "lc.l.released", "release_collateral → lender", chainC);
arrow("ac.member", "lc.e.open", "wrap · sealed bid · lock", { stroke: C.member.stroke, from: "r", to: "l" });
arrow("ac.admin", "lc.e.closed", "runs the desk", { from: "r", to: "l" });
arrow("ac.public", "lc.e.printed", "re-verify", { ...READ, from: "r", to: "l" });

// programs — CPIs and reads inside f4; the band above the heads carries the long runs
arrow("p.wrap.h", "p.x.token22", "transfer_checked · mint_to · burn · CT Deposit", chainC);
arrow("p.auc.h", "p.x.zk", "closes the bid's proof account", {
  ...chainC,
  tdx: cx(need("p.auc.h")) - cx(need("p.x.zk")),
});
arrow("p.cr.h", "p.x.zk", "closes its four proof accounts", {
  ...chainC,
  route: { kind: "H", y: BAND(4), tdx: need("p.x.zk").x + need("p.x.zk").width - 100 - cx(need("p.x.zk")) },
});
arrow("p.orc.h", "p.auc.h", null, chainC);
arrow("p.cr.h", "p.orc.h", null, READ);
arrow("p.wrap.h", "p.reg.h", null, READ);
arrow("p.auc.acc", "p.orc.h", null, { ...READ, from: "r", to: "l" });
arrow("p.cr.quote", "p.x.pyth", "④ source 4: read Pyth's account directly", {
  ...VIO,
  route: { kind: "V", x: V2, lane: 5, tdx: -12 },
});
arrow("p.cr.listing", "p.cr.cache", "seeds on listing.feed_id", chainC);
arrow("p.cr.loan", "p.cr.listing", "Loan.listing, bound at lock", { ...READ, from: "r", to: "l" });

// cryptography → programs / sdk (the V2 gutter, lanes 0–7)
arrow("cr.pocd", "p.orc.h", "the PoCD, one per published total", {
  stroke: C.crypto.stroke,
  ...T,
  route: { kind: "VB", x: V2, lane: 0, y: BAND(0) },
});
arrow("cr.bid", "p.auc.h", "a bid's validity + range proofs", {
  stroke: C.crypto.stroke,
  ...T,
  route: { kind: "VB", x: V2, lane: 1, y: BAND(1) },
});
arrow("cr.clear", "p.orc.h", "the clearing rule, recomputed on chain", {
  stroke: C.crypto.stroke,
  route: { kind: "VB", x: V2, lane: 2, y: BAND(2), tdx: 60 },
});
arrow("cr.transport", "p.x.zk", "every proof is verified here", {
  stroke: C.crypto.stroke,
  route: { kind: "VB", x: V2, lane: 3, y: BAND(3), tdx: 120 },
});
arrow("cr.solv", "p.cr.h", "the solvency proof over E_Δ", {
  stroke: C.crypto.stroke,
  ...T,
  route: { kind: "VB", x: V2, lane: 6, y: BAND(6), tdx: -60 },
});
const kRight = need("cr.c.elgamal").x + need("cr.c.elgamal").width;
arrow("cr.c.elgamal", "cr.c.proofs", null, { stroke: C.crypto.stroke, route: { kind: "V", x: kRight + 16 } });
arrow("cr.c.proofs", "cr.c.wasm", null, { stroke: C.crypto.stroke, route: { kind: "V", x: kRight + 32 } });
arrow("cr.c.wasm", "sd.sdk.zk", "the same provers, compiled for the browser", { stroke: C.crypto.stroke });

// services → programs (the R2 corridor, lanes 0–5; column heads of f6 sit right under the column tails of f4)
arrow("sv.setup", "p.reg.ix", "initialise · admit members · add listings");
arrow("sv.agents", "p.wrap.ix", "wrap 20,000 shares once");
arrow("sv.agents", "p.auc.ix", "submit_bid in 3 tx", { route: { kind: "H", rowY: R2, lane: 1, fdx: -60, tdx: -60 } });
arrow("sv.agents", "p.cr.ix", "lock, then deposit into escrow", {
  route: { kind: "H", rowY: R2, lane: 2, fdx: 60, tdx: -120 },
});
arrow("sv.keeper", "p.auc.ix", "open_epoch · close_epoch · close_bid ×8", { fdx: -60, tdx: 60 });
arrow("sv.keeper", "p.cr.ix", "post_price · seize", {
  route: { kind: "H", rowY: R2, lane: 0, fdx: 60, tdx: -60 },
});
arrow("sv.administrator", "p.orc.ix", "decrypt · clear · begin / attest / finalize", { ...T, tdx: -40 });
arrow("sv.administrator", "p.cr.ix", "post_match Full | Partial · confirm_funding · repay", {
  route: { kind: "H", rowY: R2, lane: 3, fdx: 80, tdx: 0 },
});
arrow("sv.operator", "p.cr.ix", "confirm_lock · release_collateral (+ CT transfer)", { fdx: 60, tdx: 60 });
arrow("sv.poster", "p.x.pyth", "forwards the signed price to Pyth's receiver", {
  ...VIO,
  route: { kind: "V", x: V2, lane: 7, tdx: 12 },
});
arrow("sv.administrator", "sv.matching", "matching → post_match", { from: "l", to: "r" });

// sdk / app → programs & services (out of the SDK column's left side, up the V2 gutter, along an R2 lane)
arrow("sd.sdk.tx", "p.cr.ix", "lock and deposit plans", {
  stroke: C.app.stroke,
  ...T,
  route: { kind: "VB", x: V2, lane: 0, y: laneY(R2, 0), fdx: -16, tdx: 120 },
});
arrow("sd.sdk.tx", "p.auc.ix", "buildBidPlan → submit_bid", {
  stroke: C.app.stroke,
  ...T,
  route: { kind: "VB", x: V2, lane: 1, y: laneY(R2, 1), fdx: 0, tdx: 120 },
});
arrow("sd.sdk.tx", "p.wrap.ix", "buildOnboardPlan · buildWrapPlan", {
  stroke: C.app.stroke,
  route: { kind: "VB", x: V2, lane: 3, y: laneY(R2, 5), fdx: 16, tdx: 120 },
});
arrow("sd.sdk.verify", "p.orc.ix", "verifyPrint reads the round and its proofs", {
  ...READ,
  stroke: C.app.stroke,
  route: { kind: "VB", x: V2, lane: 2, y: laneY(R2, 4), tdx: 60 },
});
arrow("sd.app.desk", "sd.sdk.tx", null, { stroke: C.app.stroke, from: "l", to: "r" });
arrow("sd.app.positions", "sd.sdk.lock", null, { stroke: C.app.stroke, from: "l", to: "r" });
arrow("sd.app.explorer", "sd.sdk.verify", "Re-verify", { stroke: C.app.stroke, from: "l", to: "r" });
arrow("sd.app.market", "sd.sdk.accounts", null, { stroke: C.app.stroke, from: "l", to: "r" });
arrow("sd.app.shell", "sv.http", "the faucet and the descriptor", {
  stroke: C.app.stroke,
  route: { kind: "H", rowY: R3, lane: 0, fdx: -100 },
});

// tracks → services / programs (Pyth is the right column of f8, so its runs reach the V1 gutter directly)
arrow("tr.py.hermes", "tr.py.s1", "the price, with its own timestamp", { stroke: C.pyth.stroke });
arrow("tr.py.s1", "tr.py.s2", "②", { stroke: C.pyth.stroke });
arrow("tr.py.s2", "tr.py.s3", "③", { stroke: C.pyth.stroke });
arrow("tr.py.s3", "tr.py.s4", "④", { stroke: C.pyth.stroke });
arrow("tr.py.s1", "sv.price", "the keeper posts it (source 0)", {
  stroke: C.pyth.stroke,
  route: { kind: "V", x: V1, lane: 1, tdx: -20 },
});
arrow("tr.py.s3", "p.cr.sch", "③ listings + the quote-age rule", {
  stroke: C.pyth.stroke,
  route: { kind: "VB", x: V1, lane: 2, y: BAND(5) },
});
arrow("tr.py.s4", "sv.poster", "④ the poster (waits for a Pyth key)", {
  ...VIO,
  route: { kind: "HV", rowY: R3, x: V2, lane: 1, fdx: 200, tdx: 0 },
});
arrow("tr.ps.h", "tr.ps.api", "the mark the keeper copies (source 2)", { stroke: C.prestocks.stroke });
arrow("tr.xs.h", "tr.xs.wrap", "devnet twins today → real mints later", { stroke: C.xstocks.stroke });
arrow("tr.ts.h", "tr.ts.listing", "listing-retire (DROPPED → RETIRED)", GREY);
arrow("tr.mc.h", "tr.mc.plan", "the desk's numbers shape the pool", AMB);
arrow("tr.mc.plan", "tr.mc.code", "the code", AMB);
arrow("tr.mc.code", "sv.launch", "the launch tool", {
  ...AMB,
  route: { kind: "H", rowY: R3, lane: 2, fdx: 100, tdx: 60 },
});

// tests
arrow("ts.t1.h", "p.reg.h", "the tier-1 harness drives all five programs", {
  stroke: C.tests.stroke,
  route: { kind: "HV", rowY: R3, x: V1, lane: 3, fdx: 0, tdx: 0 },
});
arrow("ts.ci", "ts.t1.h", null, { stroke: C.tests.stroke, route: { kind: "V", x: need("ts.t2.h").x - 20 } });

// ═════════════════════════════════ write ═════════════════════════════════
const file = {
  type: "excalidraw",
  version: 2,
  source: "https://github.com/kaustubh76/Blinds — scripts/project_diagram.mjs",
  elements,
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: {},
};
const json = `${JSON.stringify(file, null, 2)}\n`;
if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== json) {
    console.error(`docs/project.excalidraw is stale — run \`pnpm docs:diagrams\``);
    process.exit(1);
  }
  console.log(`docs/project.excalidraw is current (${elements.length} elements)`);
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT}: ${elements.length} elements`);
}
