/**
 * Clawpump (clawpump.tech/developers): the lender agent's identity and wallet, and the identity coin
 * Clawpump launches for it. Clawpump's own launch venue is pump.fun — `pumpQuoteMint` pairs the coin
 * with a stock from `GET /pump-pairs` (TSLAx among them); the Meteora pool (main.ts) is a separate,
 * desk-configured curve. The bearer key is read from the environment and never logged.
 */

export const CLAWPUMP_API = "https://clawpump.tech/api/v1";
/** TSLAx (xStocks) — the pair Clawpump lists for a stock-paired launch. */
export const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

export interface ClawpumpAgent {
  id: string;
  name: string;
  walletAddress: string;
  status?: string;
}

export const LENDER_PERSONA =
  "An autonomous lender on THE WINDOW for Stocks, a private margin desk for tokenized stocks on Solana: it lends USDC every overnight window against tokenized-stock collateral proven solvent in zero knowledge, and earns the xONIA overnight rate. Its capital token WLEND trades on a TSLAx-quoted Meteora DBC pool; its identity coin is paired with TSLAx on pump.fun.";

/** Which agent to use: an explicit id wins; a single agent on the account is reused; otherwise a new one. */
export function pickAgent(
  agents: ClawpumpAgent[],
  explicitId: string | undefined,
  forceNew: boolean,
): { action: "update"; agent: ClawpumpAgent } | { action: "create" } {
  if (forceNew) return { action: "create" };
  if (explicitId) {
    const a = agents.find((x) => x.id === explicitId);
    if (!a) throw new Error(`CLAWPUMP_AGENT_ID ${explicitId} is not an agent of this key`);
    return { action: "update", agent: a };
  }
  if (agents.length === 1 && agents[0]) return { action: "update", agent: agents[0] };
  if (agents.length > 1) throw new Error(`the key owns ${agents.length} agents — set CLAWPUMP_AGENT_ID to pick one`);
  return { action: "create" };
}

export interface LaunchBodyInput {
  agentId: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  quoteMint: string;
  creatorFeeBps: number;
  website?: string;
  twitter?: string;
}

/** The `POST /launch` body for a stock-paired, agent-funded launch (the agent's own wallet pays). */
export function launchBody(i: LaunchBodyInput) {
  if (i.symbol.length < 1 || i.symbol.length > 10) throw new Error("symbol must be 1–10 characters");
  if (i.description.length < 20 || i.description.length > 500) throw new Error("description must be 20–500 characters");
  if (!/^https:\/\//.test(i.imageUrl)) throw new Error("imageUrl must be https");
  if (i.creatorFeeBps < 100 || i.creatorFeeBps > 300) throw new Error("pumpCreatorFeeBps is 100–300 on custom pairs");
  return {
    agentId: i.agentId,
    name: i.name,
    symbol: i.symbol,
    description: i.description,
    imageUrl: i.imageUrl,
    pumpQuoteMint: i.quoteMint,
    pumpCreatorFeeBps: i.creatorFeeBps,
    selfFunded: true,
    initialBuySol: 0,
    ...(i.website ? { website: i.website } : {}),
    ...(i.twitter ? { twitter: i.twitter } : {}),
  };
}

export interface ClawpumpError extends Error {
  status: number;
  requestId?: string;
  body?: unknown;
}

/** One call against the Clawpump API; errors carry the status, the request id and the parsed body (a 402 is guidance). */
export async function clawpump<T>(
  key: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 120_000,
  fetchImpl: typeof fetch = fetch,
): Promise<{ data: T; requestId?: string }> {
  const res = await fetchImpl(`${process.env.CLAWPUMP_API_URL ?? CLAWPUMP_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  const requestId = (parsed as { meta?: { requestId?: string } } | null)?.meta?.requestId;
  if (!res.ok) {
    const e = new Error(`Clawpump ${res.status} on ${method} ${path}: ${text.slice(0, 400)}`) as ClawpumpError;
    e.status = res.status;
    e.requestId = requestId;
    e.body = parsed;
    throw e;
  }
  return { data: parsed as T, requestId };
}

/** What a 402 from `/launch` tells the operator to do (the agent wallet has to hold the launch cost). */
export function describe402(body: unknown): string {
  const b = body as { error?: string; message?: string; guidance?: unknown; payment?: unknown } | null;
  const parts = [b?.error, b?.message].filter(Boolean);
  if (b?.guidance) parts.push(JSON.stringify(b.guidance));
  if (b?.payment) parts.push(JSON.stringify(b.payment));
  return parts.length ? parts.join(" · ") : "payment required — fund the agent wallet and retry";
}
