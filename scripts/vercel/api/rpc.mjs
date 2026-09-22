/**
 * Same-origin JSON-RPC proxy for the hosted dashboard (Vercel serverless).
 *
 * Why it exists: the public devnet endpoint rate-limits per client IP, and the desk's own services
 * (keeper, operator, six agents) saturate that quota from the machine running the market — so a
 * browser on the same network was getting HTTP 429 on roughly half of its `getMultipleAccounts`
 * reads and the dashboard filled in slowly or not at all. Going through the function moves the
 * browser's reads to Vercel's egress, collapses identical reads across visitors into one upstream
 * call, and retries the 429s that remain.
 *
 * `RPC_UPSTREAM` (Vercel env var) points at a dedicated endpoint when there is one; the key stays
 * server-side and never reaches the bundle. Without it, the public endpoint is used.
 */
const UPSTREAM = process.env.RPC_UPSTREAM || "https://api.devnet.solana.com";
const CACHE_MS = Number(process.env.RPC_CACHE_MS || 1200);
/** Reads only: a cached `sendTransaction` would silently drop a user's transaction. */
const CACHEABLE = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getSlot",
  "getBlockHeight",
  "getEpochInfo",
  "getMinimumBalanceForRentExemption",
  "getTokenAccountsByOwner",
]);
/** Per-instance, tiny and short-lived: it exists to absorb a burst, not to serve stale state. */
const cache = new Map();

const methodsOf = (body) => {
  try {
    const parsed = JSON.parse(body);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((m) => m?.method).filter(Boolean);
  } catch {
    return [];
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function forward(body) {
  let last;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (res.status !== 429 && res.status < 500) return { status: res.status, text: await res.text() };
    last = { status: res.status, text: await res.text() };
    await sleep(120 * 2 ** i + Math.random() * 80);
  }
  return last;
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type,solana-client");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST a JSON-RPC body" });

  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  const methods = methodsOf(body);
  const cacheable = methods.length > 0 && methods.every((m) => CACHEABLE.has(m));

  if (cacheable) {
    const hit = cache.get(body);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      res.setHeader("x-rpc-cache", "hit");
      return res.status(hit.status).send(hit.text);
    }
  }

  try {
    const out = await forward(body);
    if (cacheable && out.status === 200) {
      cache.set(body, { ...out, at: Date.now() });
      if (cache.size > 500) for (const k of [...cache.keys()].slice(0, 250)) cache.delete(k);
    }
    res.setHeader("x-rpc-cache", cacheable ? "miss" : "bypass");
    res.setHeader("content-type", "application/json");
    return res.status(out.status).send(out.text);
  } catch (e) {
    return res.status(502).json({ error: `upstream unreachable: ${e instanceof Error ? e.message : e}` });
  }
}
