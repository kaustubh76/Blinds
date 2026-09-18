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
| Developer surface | Build page (`#/build`): the live schedule row for `TSLAx-mock` (listing / price-cache PDA / feed id, both verdicts), the **Pyth** track column, and the `pyth-mainnet` recipe — the browser reads `Crypto.TSLAX/USD` and `Equity.US.TSLA/USD` from Pyth's mainnet push accounts (`fetchFreshest`, `decodePriceUpdate`, `basisBps`, `nyseSession`) and shows the shard-0 account's age; `solvency` recipe: `k_c`/`k_l` and the pledge for 1,000 USDC. Console titles `credit.PricePosted · TSLAx-mock $…`; DevTools `thewindow.schedule()`. | live |
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
| Developer surface | Build page: the `T-OpenAI-mock` schedule row, the **Tessera** column (`feedIdForLabel("tessera:T-OpenAI")` → `fetchPrice`, `fetchListing(cstockMint)`, `buildLockPlan({ listing, feedId, mockMint, haircutBps })`, the `token-details` `curl`, explorer links to listing and escrow), the `marks` recipe (the label → feed-id rule, proven against the chain), the `solvency` recipe (200 % pledge). The API sends no CORS headers, so the on-chain cache is the browser's source — said on the page. | live |

## PreStocks — criteria → what answers them

| Judged on | Where it is answered | Stage |
|---|---|---|
| Creativity | The same desk lists `ANTHROPIC` next to a listed stock and a Tessera token under one rate — a collateral schedule, the way a prime desk actually runs. | 3 |
| Integration depth | `/api/prestocks` `markPrice` → keeper → `PriceCache` (`price_source = 2`); `tokenPrice` vs `markPrice` shown as the PreStocks basis in the schedule table. | 3 |
| Product quality | Listing selector on the Desk, per-listing lock/deposit on Positions, schedule with quote ages on Market; tier-1 attack cases for wrong-listing and stale-quote paths; tier-2 lifecycle on a second listing. | 3 |
| Developer surface | Build page: the `ANTHROPIC-mock` schedule row, the **PreStocks** column (`feedIdForLabel("prestocks:ANTHROPIC")`, the `/api/prestocks` `curl`, the same SDK calls), `marks` and `solvency` recipes (ANTHROPIC: 1.965 shares required, 3.143 pledged after the 200 % haircut for 1,000 USDC); console events named by listing (`credit.PricePosted · ANTHROPIC-mock $…`). | live |

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
| 2 | Dashboard: underlying vs wrapper panel (Pyth mainnet read via a browser-friendly RPC), wrapper basis, stale badge | done 17 Sep (`app/src/lib/pyth.ts`, `CollateralMark.tsx`) |
| 3 | `Listing` upgrade of `window_credit` (+ `migrate_loan`), per-listing keeper sources (Tessera, PreStocks), SDK/app selectors and schedule, tier-1/2 tests, devnet upgrade with three listings | done 17 Sep — tier 1 green, tier 2 15/15, devnet upgraded (programdata +33,125 B; listings `5pJXoG…` TSLAx, `BAUiqw…` T-OpenAI, `4qQ4A9…` ANTHROPIC; 65 loans migrated) |
| 4 | Pyth stretch: receiver-owned account read on chain for the Pyth listing (only if 3 is green on devnet by Tue 22) | — |
| 5 | `docs/PYTH.md`, `docs/LISTINGS.md`, README, submissions, market restart, freeze + tag | docs written 17 Sep; **verified on devnet 18 Sep** (below); `docs/RUNBOOK.md`; submissions and freeze open |

## Verified on devnet, 18 Sep 2026

Executed step by step from a fresh browser (a devnet burner, no extension), against the live keeper:

| step | evidence |
|---|---|
| tier 1 on the final sources | `attack_07` (4) · `attack_09` (2) · `attack_10` (2) · `e2e::loan_lifecycle` (4, incl. the second listing and a legacy migration) — 18/18 green; `window-admin` price parsers green |
| Pyth | Hermes, hermes-beta and Benchmarks all answer **401 without a key**; `Crypto.TSLAX/USD` has **one** push account on mainnet (shard 0 `GpoWLTd6…`, dead since 12 Sep 12:18 UTC — shards 1–39 do not exist); the keeper posts it with its true timestamp and the chain refuses TSLAx locks (`QuoteStale`, 137 h > 1 h). The equity feed's shard 1 (`FQB8c4zB…`) is live and is what the dashboard shows beside it. A Pyth Pro key turns the listing back on; nothing else does. |
| Tessera | `GET token-details` → `T-OpenAI` `markPrice` 812.79 (no browser UA needed); `price-check` posts the same; the API returned **500 three times** during the run and the keeper re-posted the last good mark, as designed |
| PreStocks | `GET /api/prestocks` → `ANTHROPIC` `markPrice` 1016.50 vs `tokenPrice` 1003.53 (basis −127.6 bp); posted as 1016.33–1017.30 across ticks |
| schedule on chain | `pnpm schedule`: within one keeper tick both marks **ACCEPTED** for lock and seize, TSLAx **REFUSED**; the same badges on the Market table |
| T-OpenAI-mock, borrower | burner `GxkN3AVb…`: join → confidential account on `GRDt32…` → wrap → bid (epoch 263, printed 5.00 %, 2,875 USDC matched) → loan `EssLWbVx…` bound to `BAUiqw…` → 6-tx lock at `priceCents 81279`, `k_l 200` (`xZrrcuqK…`) → 6-tx confidential deposit into escrow `AmL991…` (`66uzREPG…`) → operator confirmed → funded → left to default by the demo policy |
| ANTHROPIC-mock, same burner | listing switch = one extra token-account signature → new confidential account on `DA7UsQ…` → wrap → bid (epoch 270, printed 4.00 %, 1,000 USDC matched) → loan `ApZ9txst…` bound to `4qQ4A9…` → lock at `priceCents 101730`, `k_l 200` (`4o2tTnTs…`) → deposit into `93myeN…` (`4ga6KneR…`) → Locked |
| faucet | funds a wallet once, mints every listed collateral; `already_member` on a second call |

Found and fixed along the way (app/ops, commits `4fb4cae`…): the listing picker reverted its pick; the
faucet minted listing #0 into the selected listing's account; a listing switch left the token signature
behind; the autopilot failed between windows. Then in the schedule's own code, same day: only agents 0
and 1 bid — one borrower's loan service ran between agents' bids and outlasted the window (`2332d38`:
two-pass tick, per-agent bid memory, warnings once); lenders held no account on listings 1/2 so
defaulted loans there could not be released (`48474c3`: every agent gets a confidential account on every
listing); the schedule row showed "no price yet" under RPC 429s and the CollateralMark footnote
predated the quote-age rule (`9350eab`).

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
