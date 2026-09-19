/**
 * Mounts the real-time layer once (see `live.ts`), routes what arrives into the query cache and
 * the developer console, and exposes a small store for the UI: connection state + last events.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { config } from "../config";
import { describeError } from "./chain";
import { devConsole, jsonSafe } from "./console";
import { type LiveEvent, startLive } from "./live";
import { readPref } from "./prefs";
import { useDeployment } from "./queries";

export interface LiveState {
  enabled: boolean;
  connected: boolean;
  attempts: number;
  events: readonly LiveEvent[];
}

let state: LiveState = { enabled: readPref("live", true), connected: false, attempts: 0, events: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const MAX_EVENTS = 40;
const GIVE_UP_AFTER = 6;
let started = false;

/** A listing's symbol for an event that carries its feed id or its listing PDA. */
function describeEvent(
  e: LiveEvent,
  listings: Array<{ symbol: string; listing: string; feedId: Uint8Array }> | undefined,
): string {
  const d = e.data as Record<string, unknown> | null;
  if (!d || !listings) return `${e.program}.${e.name}`;
  const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const feed = d.feedId instanceof Uint8Array || Array.isArray(d.feedId) ? hex(d.feedId as ArrayLike<number>) : null;
  const byFeed = feed ? listings.find((l) => hex(l.feedId) === feed) : undefined;
  const byPda = typeof d.listing === "string" ? listings.find((l) => l.listing === d.listing) : undefined;
  const l = byFeed ?? byPda;
  if (e.name === "PricePosted" && typeof d.price === "bigint" && typeof d.expo === "number") {
    const v = (Number(d.price) * 10 ** d.expo).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `credit.PricePosted · ${l?.symbol ?? "unknown listing"} $${v}`;
  }
  if (l) return `${e.program}.${e.name} · ${l.symbol}`;
  return `${e.program}.${e.name}`;
}

export function useLiveEvents(): LiveState {
  const qc = useQueryClient();
  const dep = useDeployment();
  const listingsRef = useRef(dep.data?.listings);
  listingsRef.current = dep.data?.listings;
  useEffect(() => {
    if (started || !state.enabled) return;
    started = true;
    const ctrl = new AbortController();
    devConsole.push({ kind: "note", title: `real-time: subscribing at ${config.wsUrl}` });
    void startLive({
      wsUrl: config.wsUrl,
      signal: ctrl.signal,
      // All five programs' logs: registry (membership) and wrap (balances) events reach the console too.
      programs: ["registry", "auction", "oracle", "wrap", "credit"],
      onInvalidate: (what) => {
        const keys =
          what === "auction" ? ["auctionConfig", "epoch", "print", "series", "slot"] : ["oracle", "print", "series"];
        for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
      },
      onEvent: (e) => {
        set({ events: [...state.events, e].slice(-MAX_EVENTS) });
        devConsole.push({
          kind: "event",
          title: describeEvent(e, listingsRef.current),
          signature: e.signature,
          programs: [e.program],
          detail: e.data,
          at: e.at,
        });
        // Loans and bids change on credit/auction events; membership on registry ones; balances on wrap ones.
        if (e.program === "credit") void qc.invalidateQueries({ queryKey: ["loans"] });
        if (e.program === "credit" && e.name === "ListingAdded") void qc.invalidateQueries({ queryKey: ["listings"] });
        if (e.program === "credit" && e.name === "PricePosted")
          for (const k of ["price", "quotes", "build-schedule", "build-mark"])
            void qc.invalidateQueries({ queryKey: [k] });
        if (e.program === "registry") void qc.invalidateQueries({ queryKey: ["member"] });
        if (e.program === "wrap")
          for (const k of ["tokenAccounts", "balances", "sol"]) void qc.invalidateQueries({ queryKey: [k] });
        if (e.program === "auction" && e.name === "BidSubmitted") void qc.invalidateQueries({ queryKey: ["bids"] });
      },
      onStatus: (s) => {
        set({ connected: s.connected, attempts: s.connected ? 0 : s.attempt + 1 });
        if (s.connected)
          devConsole.push({ kind: "note", title: "real-time: connected (account + logs subscriptions)" });
        else if (s.attempt + 1 >= GIVE_UP_AFTER) {
          devConsole.push({
            kind: "note",
            title: "real-time: giving up after repeated failures — polling continues; set a WebSocket URL in Settings",
            error: s.error ?? "",
          });
          ctrl.abort();
          set({ enabled: false, connected: false });
        } else if (s.error) {
          devConsole.push({
            kind: "note",
            title: `real-time: reconnecting (${s.attempt + 1}) — ${describeError(new Error(s.error))}`,
          });
        }
      },
    });
    return () => {
      // The layer outlives React's StrictMode double-mount on purpose; nothing to tear down per render.
    };
  }, [qc]);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** The decoded event body, compact, for a one-line display. */
export const describeEventData = (e: LiveEvent): string => jsonSafe(e.data, 0);
