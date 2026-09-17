/**
 * The developer console's store: a bounded log of what the app did to the chain and what the
 * chain did back. Entries are plain data; secrets never enter (see `asCode` for the redaction).
 */
import { useSyncExternalStore } from "react";
import { readPref, writePref } from "./prefs";

export type EntryKind = "call" | "tx" | "chain" | "event" | "note";
export type TxState = "pending" | "sent" | "confirmed" | "failed";

export interface Entry {
  id: number;
  at: number;
  kind: EntryKind;
  title: string;
  /** A TypeScript snippet reproducing the call (already redacted). */
  code?: string;
  signature?: string;
  state?: TxState;
  /** Program ids touched (for `call`/`tx`), or the emitting program (for `event`). */
  programs?: string[];
  error?: string;
  detail?: unknown;
}

export const CONSOLE_CAPACITY = 500;

let entries: readonly Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let open = readPref("console", false);
const openListeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export const devConsole = {
  push(e: Omit<Entry, "id" | "at"> & { at?: number }): number {
    const id = nextId++;
    const entry: Entry = { ...e, id, at: e.at ?? Date.now() };
    const next = entries.length >= CONSOLE_CAPACITY ? entries.slice(entries.length - CONSOLE_CAPACITY + 1) : entries;
    entries = [...next, entry];
    notify();
    return id;
  },
  update(id: number, patch: Partial<Omit<Entry, "id">>): void {
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    const copy = entries.slice();
    copy[i] = { ...(entries[i] as Entry), ...patch };
    entries = copy;
    notify();
  },
  clear(): void {
    entries = [];
    notify();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot(): readonly Entry[] {
    return entries;
  },
  isOpen(): boolean {
    return open;
  },
  setOpen(v: boolean): void {
    open = v;
    writePref("console", v);
    for (const l of openListeners) l();
  },
  toggle(): void {
    devConsole.setOpen(!open);
  },
  subscribeOpen(cb: () => void): () => void {
    openListeners.add(cb);
    return () => openListeners.delete(cb);
  },
};

export function useConsole(): readonly Entry[] {
  return useSyncExternalStore(devConsole.subscribe, devConsole.getSnapshot, devConsole.getSnapshot);
}

export function useConsoleOpen(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(devConsole.subscribeOpen, devConsole.isOpen, devConsole.isOpen);
  return [v, devConsole.setOpen];
}

/** `JSON.stringify` that survives bigint, Uint8Array and Address-like values. */
export function jsonSafe(value: unknown, space = 2): string {
  return JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v === "bigint") return `${v.toString()}n`;
      if (v instanceof Uint8Array) return `0x${Array.from(v, (x) => x.toString(16).padStart(2, "0")).join("")}`;
      if (v instanceof Map) return Object.fromEntries(v);
      if (v instanceof Error) return { error: v.message };
      return v;
    },
    space,
  );
}
