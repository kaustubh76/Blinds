/**
 * Mounts the real-time layer once (see `live.ts`), routes what arrives into the query cache and
 * the developer console, and exposes a small store for the UI: connection state + last events.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { config } from "../config";
import { devConsole, jsonSafe } from "./console";
import { type LiveEvent, startLive } from "./live";
import { readPref } from "./prefs";

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

export function useLiveEvents(): LiveState {
  const qc = useQueryClient();
  useEffect(() => {
    if (started || !state.enabled) return;
    started = true;
    const ctrl = new AbortController();
    devConsole.push({ kind: "note", title: `real-time: subscribing at ${config.wsUrl}` });
    void startLive({
      wsUrl: config.wsUrl,
      signal: ctrl.signal,
      onInvalidate: (what) => {
        const keys =
          what === "auction" ? ["auctionConfig", "epoch", "print", "series", "slot"] : ["oracle", "print", "series"];
        for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
      },
      onEvent: (e) => {
        set({ events: [...state.events, e].slice(-MAX_EVENTS) });
        devConsole.push({
          kind: "event",
          title: `${e.program}.${e.name}`,
          signature: e.signature,
          programs: [e.program],
          detail: e.data,
          at: e.at,
        });
        // Loans and bids change on credit/auction events; membership on registry ones.
        if (e.program === "credit") void qc.invalidateQueries({ queryKey: ["loans"] });
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
          devConsole.push({ kind: "note", title: `real-time: reconnecting (${s.attempt + 1}) — ${s.error}` });
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

export const describeEvent = (e: LiveEvent): string => jsonSafe(e.data, 0);
