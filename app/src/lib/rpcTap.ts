/**
 * A tap on the RPC transport: while it is recording, every JSON-RPC call the page makes — including
 * the ones made *inside* the SDK, which is the point — is kept with its params, its answer and how
 * long it took, and can be rendered as the `curl` that reproduces it.
 *
 * Recording is off until `start()` is called, and the wrapper then costs one `Date.now()` and one
 * array push per call. Nothing here is on by default, so the routes that never open the inspector
 * pay nothing for it.
 */
import type { RpcTransport } from "@solana/kit";

export interface RpcCall {
  id: number;
  /** `getAccountInfo`, `getProgramAccounts`, … as it went over the wire. */
  method: string;
  params: unknown;
  /** Milliseconds from call to settle. */
  ms: number;
  ok: boolean;
  /** The body the transport returned, trimmed to `MAX_BODY` characters when rendered. */
  response?: unknown;
  error?: string;
  /** The JSON length of the answer, which is the only honest measure of what the RPC sent back. */
  bytes: number;
}

/** A recorded window is a debugging aid, not a log: it is bounded and the oldest calls fall off. */
export const MAX_CALLS = 200;
/** How much of a response body the inspector shows. A `getProgramAccounts` answer is unreadable whole. */
export const MAX_BODY = 4000;

let recording = false;
let calls: RpcCall[] = [];
let nextId = 1;
let endpoint = "";

function payloadOf(p: unknown): { method: string; params: unknown } {
  if (typeof p === "object" && p !== null && "method" in p) {
    const o = p as { method?: unknown; params?: unknown };
    return { method: typeof o.method === "string" ? o.method : "?", params: o.params };
  }
  return { method: "?", params: undefined };
}

function sizeOf(v: unknown): number {
  try {
    return wireJson(v)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Wraps a transport. The wrapper is installed once, at module load, whether or not anyone ever
 * records: a transport cannot be swapped under a live `Rpc` object.
 */
export function tapTransport(inner: RpcTransport, url: string): RpcTransport {
  endpoint = url;
  return async function tapped<TResponse>(config: Parameters<RpcTransport>[0]): Promise<TResponse> {
    if (!recording) return inner<TResponse>(config);
    const { method, params } = payloadOf(config.payload);
    const id = nextId++;
    const t0 = Date.now();
    const push = (e: RpcCall) => {
      calls.push(e);
      if (calls.length > MAX_CALLS) calls = calls.slice(calls.length - MAX_CALLS);
    };
    try {
      const res = await inner<TResponse>(config);
      push({ id, method, params, ms: Date.now() - t0, ok: true, response: res, bytes: sizeOf(res) });
      return res;
    } catch (e) {
      push({
        id,
        method,
        params,
        ms: Date.now() - t0,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        bytes: 0,
      });
      throw e;
    }
  } as RpcTransport;
}

/** The single-quote-safe form of a JSON body inside a `curl -d '…'`. */
function shellSingleQuoted(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * JSON-RPC params carry bigints — a slot, an epoch, a rent size — and `JSON.stringify` throws on one
 * rather than encoding it. That throw used to happen inside the inspector's *render*, where React's
 * error boundary swallowed it and replaced the whole page with the error screen: a debugging aid that
 * took the page down. So bigints become numbers, which is what the real transport puts on the wire, and
 * anything beyond what a double can hold exactly becomes a string with a note rather than a wrong value.
 */
function wireJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v !== "bigint") return v;
    return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(v)
      : `${v.toString()} /* too large for JSON */`;
  });
}

export const rpcTap = {
  /** Begin a fresh recording. Any previous one is discarded. */
  start(): void {
    calls = [];
    recording = true;
  },
  /** Stop recording and hand back what was seen, oldest first. */
  stop(): RpcCall[] {
    recording = false;
    return calls;
  },
  isRecording(): boolean {
    return recording;
  },
  /** What has been seen so far, without stopping. */
  peek(): readonly RpcCall[] {
    return calls;
  },
  endpoint(): string {
    return endpoint;
  },
  /**
   * The `curl` that reproduces one call. `id: 1` rather than the live id: a developer pasting this
   * into a terminal wants a request that stands on its own, and the id is theirs to choose.
   */
  asCurl(call: RpcCall, url = endpoint): string {
    let body: string;
    try {
      body = wireJson({ jsonrpc: "2.0", id: 1, method: call.method, params: call.params ?? [] }) ?? "{}";
    } catch (e) {
      // Nothing about showing a request is worth failing a render for.
      body = `{"jsonrpc":"2.0","id":1,"method":${JSON.stringify(call.method)},"params":"<could not be rendered: ${
        e instanceof Error ? e.message : String(e)
      }>"}`;
    }
    return [
      `curl -s ${url || "<your rpc url>"} \\`,
      `  -X POST -H 'content-type: application/json' \\`,
      `  -d ${shellSingleQuoted(body)}`,
    ].join("\n");
  },
};
