/**
 * Real-time: WebSocket subscriptions on the auction/oracle state accounts (to refresh the queries
 * the moment they change) and on the programs' logs (to decode the Anchor events they emit).
 * Polling stays the source of truth; this layer only makes the page react sooner and shows a
 * developer what the programs say. Anchor's `emit!` writes `Program data: <base64>` log lines:
 * 8-byte discriminator, then the borsh body — exactly what the generated `parse*Event` decode.
 */
import { type Address, createSolanaRpcSubscriptions, getBase64Encoder, type ReadonlyUint8Array } from "@solana/kit";
import { auction, credit, oracle, PROGRAMS, pda, registry, wrap } from "@thewindow/solana-sdk";

export type ProgramName = keyof typeof PROGRAMS;

export interface EventDef {
  program: ProgramName;
  name: string;
  disc: ReadonlyUint8Array;
  parse: (bytes: Uint8Array) => unknown;
}

export interface DecodedEvent {
  program: ProgramName;
  name: string;
  data: unknown;
}

const NAMESPACES: Record<ProgramName, Record<string, unknown>> = { registry, auction, oracle, wrap, credit };

/** Every event the five programs declare, discovered from the generated clients. */
export const EVENT_TABLE: EventDef[] = (Object.keys(NAMESPACES) as ProgramName[]).flatMap((program) => {
  const ns = NAMESPACES[program];
  return Object.keys(ns)
    .filter((k) => k.endsWith("_EVENT_DISCRIMINATOR"))
    .map((k) => {
      // EPOCH_PRINTED_EVENT_DISCRIMINATOR → EpochPrinted → parseEpochPrintedEvent
      const name = k
        .slice(0, -"_EVENT_DISCRIMINATOR".length)
        .toLowerCase()
        .split("_")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join("");
      const parse = ns[`parse${name}Event`] as ((b: Uint8Array) => unknown) | undefined;
      if (!parse) throw new Error(`no parser for ${program}.${name}`);
      return { program, name, disc: ns[k] as ReadonlyUint8Array, parse };
    });
});

const PROGRAM_OF = new Map<string, ProgramName>((Object.keys(PROGRAMS) as ProgramName[]).map((k) => [PROGRAMS[k], k]));

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>, n: number): boolean {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Pure: the events in a transaction's log lines, in order. Unknown data lines are skipped. */
export function decodeProgramDataLogs(logs: readonly string[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  const b64 = getBase64Encoder();
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(b64.encode(line.slice("Program data: ".length)));
    } catch {
      continue;
    }
    if (bytes.length < 8) continue;
    const def = EVENT_TABLE.find((d) => sameBytes(d.disc, bytes, 8));
    if (!def) continue;
    try {
      out.push({ program: def.program, name: def.name, data: def.parse(bytes) });
    } catch {
      // a body that does not decode is not one of ours
    }
  }
  return out;
}

export interface LiveEvent extends DecodedEvent {
  signature: string;
  slot: number;
  at: number;
}

export interface LiveOptions {
  wsUrl: string;
  /** Which programs' logs to follow (default: auction, oracle, credit). */
  programs?: ProgramName[];
  onInvalidate: (what: "auction" | "oracle") => void;
  onEvent: (e: LiveEvent) => void;
  onStatus?: (s: { connected: boolean; attempt: number; error?: string }) => void;
  signal: AbortSignal;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Runs until `signal` aborts: (re)connects with backoff, subscribes to the two state accounts and
 * the programs' logs, and feeds callbacks. A dropped socket ends every iterator; the loop reconnects.
 */
export async function startLive(opts: LiveOptions): Promise<void> {
  const programs = opts.programs ?? ["auction", "oracle", "credit"];
  const [auctionConfig, oracleState] = await Promise.all([pda.auctionConfig(), pda.oracleState()]);
  let attempt = 0;
  while (!opts.signal.aborted) {
    const rpcSubs = createSolanaRpcSubscriptions(opts.wsUrl);
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    opts.signal.addEventListener("abort", stop, { once: true });
    // The first subscription that resolves means the socket is up.
    let up = false;
    const markUp = () => {
      if (up) return;
      up = true;
      opts.onStatus?.({ connected: true, attempt });
      attempt = 0;
    };
    try {
      const account = async (addr: Address, what: "auction" | "oracle") => {
        const it = await rpcSubs.accountNotifications(addr, { commitment: "confirmed", encoding: "base64" }).subscribe({
          abortSignal: ctrl.signal,
        });
        markUp();
        for await (const _ of it) opts.onInvalidate(what);
      };
      const logs = async (program: ProgramName) => {
        const it = await rpcSubs
          .logsNotifications({ mentions: [PROGRAMS[program]] }, { commitment: "confirmed" })
          .subscribe({ abortSignal: ctrl.signal });
        markUp();
        for await (const n of it) {
          if (n.value.err) continue;
          for (const ev of decodeProgramDataLogs(n.value.logs)) {
            opts.onEvent({
              ...ev,
              signature: n.value.signature as string,
              slot: Number(n.context.slot),
              at: Date.now(),
            });
          }
        }
      };
      await Promise.all([account(auctionConfig, "auction"), account(oracleState, "oracle"), ...programs.map(logs)]);
      if (!opts.signal.aborted) opts.onStatus?.({ connected: false, attempt, error: "socket closed" });
    } catch (e) {
      opts.onStatus?.({ connected: false, attempt, error: e instanceof Error ? e.message : String(e) });
    } finally {
      opts.signal.removeEventListener("abort", stop);
      ctrl.abort();
    }
    if (opts.signal.aborted) break;
    attempt += 1;
    await sleep(Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)) + Math.random() * 500, opts.signal);
  }
}

export const programNameOf = (address: string): ProgramName | undefined => PROGRAM_OF.get(address);
