# Track integration — Pyth · Tessera · PreStocks

Diagram: [`docs/tracks.excalidraw`](tracks.excalidraw) (open at excalidraw.com or with the VS Code Excalidraw
extension). Deadline: **Fri 26 Sep 2026**. This file is the integration record: what each sponsor judges, what in
the desk answers it, which stage delivers it, and what we do not claim. It is updated at the end of every stage.

## Tracks chosen, and why

| Track | Prize | Why it fits a private margin desk | Not chosen |
|---|---|---|---|
| **Pyth — best use of market data** | 3 months Pyth Pro | Pyth already *is* the collateral mark: its price is the `k_c` scalar inside every solvency proof and the gate on every seizure. The work makes it fresh, comparable (underlying vs wrapper) and enforced on chain. | — |
| **Tessera — pre-IPO T-Tokens** | $6,000 | "OpenAI or Kalshi T-Tokens" are Tessera's tokenized pre-IPO shares (`T-OpenAI`, `T-Kalshi`), not the OpenAI API. Pre-IPO holders are exactly who needs a position that never was public; a borrow line against `T-OpenAI` is value flowing *to* the token. | — |
| **PreStocks — pre-IPO tokens** | $5,000 | Same mechanism as Tessera with PreStocks' `ANTHROPIC` token and its published mark price. Once the collateral schedule exists, a listing is one config block. | — |
| Meteora DBC | $5,000 | | A borrow-*rate* auction has no honest mapping onto a launch bonding curve; separate web3.js-v1 stack; "mainnet beats slides" needs mainnet SOL. Dropped. |
| Clawpump | $5,000 | | Requires launching a token on Clawpump with a stock-paired pool. Not this product. Dropped. |

## What the desk becomes: one rate, a collateral schedule

Today `window_credit` accepts one collateral (the mock TSLAx) priced by one feed, both frozen in `Config` at
`initialize`. The upgrade is **additive**: a `Listing` account per eligible collateral, each with its own price
source, haircut and freshness limits; the xONIA rate, the sealed-bid window and the proofs are untouched.

```
Listing ["listing", cstock_mint]  { mock_mint, cstock_mint, escrow_account, feed_id[32],
                                    price_source (0 Pyth · 1 Tessera · 2 PreStocks · 3 mock),
                                    haircut_bps, max_price_age (slots), max_publish_age_secs, symbol[16], decimals }
PriceCache ["price", feed_id]     { feed_id, price, expo, publish_time, posted_slot, posts }   — one per listing
Loan.listing                      bound at lock_collateral; deposit / seize / release check it
```

Two freshness rules, both on chain, checked at `lock_collateral` and `seize`:

1. `slot − posted_slot ≤ listing.max_price_age` — the keeper is alive (existed before).
2. `now − price.publish_time ≤ listing.max_publish_age_secs` — **the quote itself is fresh** (new). The keeper
   posts what the source published with its true timestamp; the chain decides whether it is usable.

Planned devnet schedule:

| Listing | Source | `feed_id` | Haircut | Quote limit |
|---|---|---|---|---|
| `TSLAx-mock` | Pyth `Crypto.TSLAX/USD` via Hermes (bearer key), on-chain push account as fallback | `0x47a15647…a362` (Pyth id) | 150 % | 1 h |
| `T-OpenAI-mock` | Tessera public API `markPrice` for mint `oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ` | `sha256("tessera:T-OpenAI")` — a label, not a Pyth id | 200 % | 48 h |
| `ANTHROPIC-mock` | PreStocks public API `markPrice` for `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | `sha256("prestocks:ANTHROPIC")` — a label | 200 % | 48 h |

The `-mock` mints are devnet twins (Token-2022 `ScaledUiAmount` + `PermanentDelegate`, wrapped 1:1 into a
confidential mint by `window_wrap`). No real xStock, T-Token or PreStocks token is touched — the desk runs on
devnet and those tokens live on mainnet.

## Pyth — criteria → what answers them

| Judged on | Where it is answered | Stage |
|---|---|---|
| How central Pyth data is | `k_c = price_scaled(price, expo) × multiplier` is a coefficient of the homomorphic Δ inside the solvency proof (`programs/window_credit/src/instructions/lock_collateral.rs`, `sdk/src/solvency.ts`); `seize` refuses without a fresh price (`lifecycle.rs`). No price → no loan, no seizure. | live |
| Technical soundness | Keeper reads Hermes with a bearer key and falls back to Pyth's own `PriceUpdateV2` accounts (owner-checked against the receiver, feed id checked); the quote's `publish_time` is stored unmodified and **enforced on chain** per listing. | 1, 3 |
| Use one feed, compare both | Dashboard shows the desk quote (`Crypto.TSLAX/USD`) beside the underlying `Equity.US.TSLA/USD` read from Pyth's mainnet account, with the wrapper basis in bps and the equity session state — the overnight window opens after the equity close, which is why the wrapper feed marks the collateral. | 2 |
| Exists post-hackathon | Hosted dashboard, devnet market, `update_listing` to retune limits without an upgrade, `price-check` for operators. | all |
| Stretch | The Pyth listing reads Pyth's receiver-owned account posted on devnet by `services/pyth-poster`, so the program trusts Pyth's signature rather than the keeper's copy for that listing. | 4 |

Incident recorded honestly: the mainnet push account `GpoWLTd6…` we copied from **stopped updating on Sat 12 Sep
2026 12:18 UTC**; until Stage 1 the desk marked collateral on that quote and the slot-based rule could not see it.
`Crypto.TSLAX/USD` is a 24/7 feed (earlier docs called it an equity feed that closes overnight — wrong; the push
account died, the feed did not).

## Tessera — criteria → what answers them

| Judged on | Where it is answered | Stage |
|---|---|---|
| A product or use case for T-OpenAI / T-Kalshi | A confidential borrow line against `T-OpenAI`: the holder wraps into a confidential mint, proves `collateral ≥ 200 % × loan` against Tessera's mark without revealing either amount, borrows at the xONIA print. | 3 |
| Drives value to the tokens | Collateral utility. A pre-IPO token you can borrow against without disclosing your position is worth more than one you can only hold. | 3 |
| Integration depth | Tessera's `token-details` mark is the on-chain `PriceCache` for the listing (`price_source = 1`), with `publish_time = keeper fetch time` — stated on chain and in the UI as an attested mark, not a feed. Listing, wrap, lock, deposit, seize, release all run per listing. | 3 |

## PreStocks — criteria → what answers them

| Judged on | Where it is answered | Stage |
|---|---|---|
| Creativity | The same desk lists `ANTHROPIC` next to a listed stock and a Tessera token under one rate — a collateral schedule, the way a prime desk actually runs. | 3 |
| Integration depth | `/api/prestocks` `markPrice` → keeper → `PriceCache` (`price_source = 2`); `tokenPrice` vs `markPrice` shown as the PreStocks basis in the schedule table. | 3 |
| Product quality | Listing selector on the Desk, per-listing lock/deposit on Positions, schedule with quote ages on Market; tier-1 attack cases for wrong-listing and stale-quote paths; tier-2 lifecycle on a second listing. | 3 |

## Honest limits (also in the UI)

- Tessera and PreStocks marks are **keeper-attested** copies of a public API, timestamped at fetch. They are not
  signed feeds. The Pyth listing is the only one whose quote carries the publisher's own timestamp (and, after
  Stage 4, the publisher's own signature).
- The administrator can decrypt individual amounts (accountable privacy — unchanged; see `docs/THREAT_MODEL.md`).
- Devnet twins, not the mainnet tokens.

## Stages and status

| Stage | Delivers | Status |
|---|---|---|
| 0 | This record + `docs/tracks.excalidraw` | done 17 Sep |
| 1 | Keeper: Hermes with key, freshest on-chain shard fallback, `price-check`, quote-age metric, doc corrections | done 17 Sep (Hermes path live once `PYTH_API_KEY` is set) |
| 2 | Dashboard: underlying vs wrapper panel (Pyth mainnet read via a browser-friendly RPC), wrapper basis, stale badge | — |
| 3 | `Listing` upgrade of `window_credit` (+ `migrate_loan`), per-listing keeper sources (Tessera, PreStocks), SDK/app selectors and schedule, tier-1/2 tests, devnet upgrade with three listings | — |
| 4 | Pyth stretch: receiver-owned account read on chain for the Pyth listing (only if 3 is green on devnet by Tue 22) | — |
| 5 | `docs/PYTH.md`, `docs/LISTINGS.md`, README, submissions, market restart, freeze + tag | — |

## Submission blurbs (drafts; finalised in Stage 5)

**Pyth.** THE WINDOW is a private margin desk for tokenized stocks. Pyth is not a widget on it — it is a
coefficient in the proof. Every loan is backed by a zero-knowledge statement `collateral × price ≥ 150 % × loan`
where `price` is Pyth's quote, so without a fresh Pyth price no collateral can be locked and no position seized.
We read Hermes with a key, fall back to Pyth's on-chain accounts, enforce the quote's own `publish_time` on chain
per listing, and show the xStock quote against the underlying equity feed with the basis, because the overnight
window opens exactly when the equity market closes.

**Tessera.** A confidential borrow line against T-OpenAI: wrap into a confidential mint, prove solvency against
Tessera's mark without revealing the position, borrow at the xONIA print. Pre-IPO holders are the people who most
need a position that never was public.

**PreStocks.** ANTHROPIC listed on the same desk under the same rate, marked by PreStocks' published price with
its implied-vs-mark basis on the schedule.
