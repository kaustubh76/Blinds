/**
 * `GET /api/marks` — the PreStocks mark and traded price, live, without a keeper (Vercel serverless).
 *
 * Why it exists: the card's implied price and basis came only from the desk's admin service, so both
 * read "—" whenever no market was running — while the README and the submission said the card shows
 * them. PreStocks' own API is public but sends no `access-control-allow-origin`, so a browser cannot
 * read it: a GET from a page origin answers 200 with no CORS header and the preflight answers 204 with
 * `allow: GET, HEAD, OPTIONS` only. This function reads it server-side and answers with CORS open, so
 * GitHub Pages (a static host with no functions of its own) can read it too.
 *
 * It answers in the admin's `/marks` shape so the dashboard needs no second decoder, and carries
 * `source: "prestocks-live"` so the page can say the numbers came from PreStocks rather than from the
 * keeper's last posted view. The mark here is PreStocks' current `markPrice` — NOT what is on chain.
 * The chain's copy is whatever the keeper last posted, and the card keeps showing that separately.
 */
const API = process.env.PRESTOCKS_URL || "https://prestocks.com/api/prestocks";
/** sha256("prestocks:ANTHROPIC") — the listing's feed id, so the page matches on the hash, not a name. */
const FEED_ID_HEX = "8bd733112c944281b9caeefc1728d935b10b95a8809bb70c11214a86fb6a89eb";
const MINT = process.env.PRESTOCKS_MINT || "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";

const e8 = (v) => Math.round(Number(v) * 1e8);

/** One row of PreStocks' API in the shape `GET <admin>/marks` answers. Exported for the unit test. */
export function snapshot(row, at = Date.now()) {
  if (!row || !Number.isFinite(Number(row.markPrice))) return null;
  const mark = e8(row.markPrice);
  const implied = Number.isFinite(Number(row.tokenPrice)) ? e8(row.tokenPrice) : null;
  return {
    key: "prestocks_anthropic",
    symbol: String(row.symbol ?? "ANTHROPIC"),
    source: "prestocks-live",
    feed_id_hex: FEED_ID_HEX,
    url: API,
    mark_e8: mark,
    implied_e8: implied,
    // Both sides are PreStocks' own current numbers, so this basis is live-vs-live: how far the token
    // trades from the mark right now. The keeper's basis compares against the mark it posted on chain.
    basis_bps: implied === null || mark === 0 ? null : Math.round(((implied - mark) / mark) * 10_000),
    ...(Number.isFinite(Number(row.markValuation)) ? { mark_valuation_usd: Number(row.markValuation) } : {}),
    ...(Number.isFinite(Number(row.impliedValuation)) ? { implied_valuation_usd: Number(row.impliedValuation) } : {}),
    ...(Number.isFinite(Number(row.supply)) ? { supply_e8: e8(row.supply) } : {}),
    fetched_at: Math.floor(at / 1000),
  };
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const upstream = await fetch(API, { signal: AbortSignal.timeout(6000) });
    if (!upstream.ok) return res.status(502).json({ error: `prestocks answered ${upstream.status}` });
    const body = await upstream.json();
    const rows = Array.isArray(body) ? body : (body?.data ?? []);
    const row = rows.find((r) => String(r?.contract_address) === MINT);
    const snap = snapshot(row);
    // No row, or a row without a usable price: say so rather than answer with an invented number. The
    // card falls back to "—" exactly as it does when the keeper is down.
    if (!snap) return res.status(502).json({ error: "no usable ANTHROPIC row in the PreStocks response" });
    res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("content-type", "application/json");
    return res.status(200).json({ [snap.key]: snap });
  } catch (e) {
    return res.status(502).json({ error: `upstream unreachable: ${e instanceof Error ? e.message : e}` });
  }
}
