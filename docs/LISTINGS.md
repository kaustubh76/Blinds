# The collateral schedule

One xONIA rate; several eligible collaterals. Each is a `Listing` account in `window_credit` with its own
price source, price cache, haircut and freshness limits. The sealed-bid window, the proofs and the rate are
untouched by which collateral a borrower pledges. (Amendment A14; track record in [`TRACKS.md`](TRACKS.md).)

## On chain

```
Listing  ["listing", cstock_mint]
  mock_mint · cstock_mint · escrow_account       the public twin, its confidential wrapper, the operator's escrow
  feed_id[32]                                    Pyth id · sha256("<source>:<symbol>") label · all-zero (mock)
  price_source                                   0 Pyth (keeper cache) · 1 reserved (a retired mark) · 2 PreStocks mark · 3 mock walk
                                                 4 Pyth's own receiver-owned account, read by the program
  haircut_bps                                    collateral value ≥ haircut × loan
  max_price_age                                  slots since the keeper posted (liveness)
  max_publish_age_secs                           seconds since the quote's own publish_time (freshness)
  symbol[16] · decimals
PriceCache ["price", feed_id]                    one per listing (sources 0–3); publish_time stored unmodified
PriceUpdateV2 (owner rec5EK…)                    source 4: Pyth's account at [pyth_shard, feed_id] under pythWSns…
Loan.listing                                     bound at lock_collateral
```

| Instruction | Who | Listing rule |
|---|---|---|
| `add_listing(params)` | admin | escrow must be the operator's account on `cstock_mint`; both mints Token-2022 with equal decimals; the mock mint carries `ScaledUiAmount` |
| `update_listing(params)` | admin | rewrites `price_source`, `haircut_bps`, the two limits and `symbol` — never mints, escrow or `feed_id` |
| `post_price(price, expo, publish_time)` | keeper | under the listing's `feed_id`; `publish_time ≤ now + 60 s`; never regresses |
| `lock_collateral` | borrower | the price account is the cache PDA (sources 0–3) or a receiver-owned `Full` `PriceUpdateV2` for the listing's feed (source 4; `BadPriceAccount` / `WrongFeed` otherwise); `slot − posted_slot ≤ max_price_age` **and** `now − publish_time ≤ max_publish_age_secs`; `k_l ← haircut_bps`; binds `Loan.listing` |
| `deposit_collateral` · `seize` · `release_collateral` | borrower · anyone · operator | the listing passed must be `Loan.listing` (`WrongListing`); seize repeats both freshness rules |
| `migrate_loan` | admin | a pre-schedule loan (414 B) is resized to 446 B and bound to the listing that mirrors `Config`'s collateral |

`Config` (frozen at `initialize`) keeps its collateral fields as a record of the original listing; no
instruction prices from them any more.

## The devnet schedule (`config/devnet.toml`)

| Listing | Source | `feed_id` | Haircut | Quote limit | What the timestamp means |
|---|---|---|---|---|---|
| `TSLAx-mock` | Pyth `Crypto.TSLAX/USD`: Hermes with `PYTH_API_KEY`, Pyth's on-chain accounts as fallback; with the poster running, source 4 — Pyth's own account on devnet (`pyth_shard = 7001` → `JBDgVnqW…`) | `0x47a15647…a362` | 150 % | 1 h | the publisher's own `publish_time` |
| `ANTHROPIC-mock` | PreStocks `GET /api/prestocks`, element `contract_address = Pren1FvF…`, field `markPrice` | `sha256("prestocks:ANTHROPIC")` | 200 % | 48 h | the keeper's fetch time (attested) |

The `-mock` mints are devnet twins: Token-2022 `ScaledUiAmount` + `PermanentDelegate`, wrapped 1:1 by
`window_wrap` into a confidential mint under the desk's auditor key. No mainnet token is touched.

**Why a twin, and not the token itself.** The real ANTHROPIC mint on mainnet is Token-2022 with ten
extensions, and three of them decide the design. `confidentialTransferMint` is the machinery this desk
wraps with in the first place. `scaledUiAmountConfig` is a rebasing multiplier, which is why the solvency
proof carries one (`mult_at_lock`) rather than a bare price. And `transferHook` — a hook, like a transfer
fee, makes a token unusable as the quote side of a bonding curve, which is why the lender agent's Meteora
pool is quoted in a tokenized *stock* rather than in the pre-IPO token. The devnet twin reproduces the two
extensions the desk depends on, and omits the hook. The Market page shows the real mint's extensions read
live from mainnet, with each one's role on hover.

**Attested marks, honestly.** PreStocks publishes a mark, not a signed feed. The keeper copies
it and stamps it with the fetch time, and says so three times: `price_source` on chain, `source` in the
profile, "attested" in the dashboard. The on-chain quote-age rule therefore bounds *how long ago the keeper
last fetched*, and the 48 h limit is the keeper's liveness promise for those listings. A source that stops
answering is re-posted with its old fetch time for at most 6 h (`MARK_KEEP_LAST_SECS`), after which the
keeper stops posting and the chain halts new locks on that listing when the limit passes — inaction, never
wrong action.

## Off chain

- **Keeper** (`services/admin/src/keeper.rs`): posts every listing at each epoch open and whenever a
  cache is older than half its `max_price_age`; seizes with the loan's own listing.
  `window-admin price-check` prints every listing's source, mark and quote age without a transaction;
  `/metrics` exposes `window_price_publish_age_seconds{listing="…"}`.
- **Agents**: borrowers are spread across the schedule (agent 1 → listing 0, agent 3 → listing 1, …);
  every agent holds a confidential account on every listing, because a defaulted loan forwards the
  loan listing's cSTOCK to the *lender*. Each tick runs in two passes — all quotes first, then the
  borrowers' loan service (proofs and up to nine transactions per loan, longer than a window) — so
  no agent's bid waits behind another's lock. Bid memory is keyed per agent. A judge who lends on
  listing 0 against a borrower on another listing receives a default payout on that listing's cSTOCK
  and needs a confidential account there: the Desk creates one when that listing is selected.
- **Poster** (`services/pyth-poster`, Node): fetches the signed `Crypto.TSLAX/USD` update from Hermes and
  posts it to Pyth's receiver on devnet every minute; started by `market.sh start` when `PYTH_API_KEY` is
  set. `window-admin listing-set-source <key> 4` flips a listing to read that account, refusing while the
  account is missing or stale; `listing-set-source <key> 0` flips it back to the keeper's cache.
- **Setup / upgrade**: `window-admin setup` creates every profile listing; on an existing deployment,
  `window-admin listings-sync` registers listing #0 from `Config`'s own mints/escrow/feed id (so its price
  cache keeps its history) and creates the rest, and `window-admin migrate-loans` resizes the pre-schedule
  loans. `scripts/upgrade_devnet.sh` runs the whole devnet upgrade: extend `programdata` if needed →
  deploy `window_credit` → sync → migrate.
- **Descriptor** (`deployments/<cluster>.json`): `listings[]` (key, symbol, source, PDA, mints, escrow,
  feed id, limits; `price_account` once a Pyth account is named, `price_source` once a listing is flipped —
  absent means "derived from `source`") and `agents[].listing`; the legacy top-level fields mirror
  `listings[0]`. The dashboard reads a listing's quote from the account the program reads (`fetchQuotes`),
  which is why the descriptor, not the on-chain `Listing`, carries `price_account`.

## SDK and dashboard

- `pda.listing(cstockMint)`, `fetchListing`, `fetchListings`, `symbolOf`, `quoteFreshness` (both rules,
  evaluated off chain for display), `feedIdForLabel`, `PriceSource`, `isAttestedMark`; `fetchQuotes` reads
  every listing's quote from whichever account the program would read (`decodePriceUpdate` for source 4);
  `buildLockPlan` / `buildDepositPlan` take the listing (and the price account for source 4);
  `lockCollateral(rpc, { …, quote: { feedId, priceSource, priceAccount } })` is the lock as one call — it reads
  the quote where the program reads it, proves, sends, and if the chain answers `DeltaMismatch` (the keeper
  reposted between the read and the send; a mock walks on every post) closes the attempt's proof contexts and
  proves once more against the new quote. The tier-2 tests and the dashboard lock this way.
- **Market**: the schedule table — source (linked), mark, quote age vs limit, post age vs limit, haircut,
  and whether a lock or seize would be accepted right now.
- **Desk**: a listing picker; the confidential account, wrap and balance follow it (one token signature
  per listing, kept in the tab).
- **Positions**: lock under the selected listing; deposit under the loan's own listing (the tab signs for
  that listing's account if it has not yet); a listing badge on every loan.
- **Build** (`#/build`, for developers): *The collateral schedule · live* — one row per listing with the
  listing PDA, price-cache PDA and feed id (copy / explorer), the mark, the haircut and the verdict the chain
  would give right now (`lock & seize accepted` / `QuoteStale` / `PriceStale`), with the SDK calls that produced
  it; *The two tracks* — a Pyth and a PreStocks column with what to call, the public-API `curl`,
  and each track's honest limit; recipes `schedule`, `pyth-mainnet`, `marks`, `solvency` run in the tab and
  print their output; `listing(cstockMint)` in the PDA table; `await thewindow.schedule()` in DevTools. The
  console names the listing on every `PricePosted` / `LockRequested` / `ListingAdded` event.

## Tests

- Tier 1 (LiteSVM): `e2e/loan_lifecycle` — a second listing locks with `k_l = 200` and its own cache; a
  legacy loan migrates once. `attacks/attack_07` — a freshly posted but old quote cannot lock or seize; a
  future quote is refused. `attacks/attack_09` — a listing's cache cannot be swapped for another's;
  deposit, seize and release are bound to the loan's listing. `attacks/attack_10` — listing management is
  admin-only and validated; migration is admin-only and bound to the original collateral.
  `attacks/attack_11` — a source-4 listing prices only from a receiver-owned, fully verified update for its own
  feed, inside the limits; the cache and the Pyth account cannot stand in for each other.
  `privacy/idl_surface` allow-lists the listing's numeric fields.
- Tier 2 (real validator): `integration/second_listing.test.ts` — a member on listing #1 wraps, bids, locks
  against listing #1's price and haircut, deposits into its escrow, and the operator confirms.

## Retiring a listing

A `Listing` cannot be closed. `window-admin listing-retire <key>` sets it to haircut 1,000,000 %, quote limit 1 s and
symbol `RETIRED` (every future lock and seize is refused; repay → release needs no price), removes it from the
descriptor (the keeper stops posting under its feed id, the dashboard stops listing it; on-chain readers show it as
retired) and moves its agents to listing #0. Delete its `[[listings]]` block from the profile too, or `listings-sync`
re-creates it. Done on devnet on 2026-09-21 for `tessera_openai` (`BAUiqw…`); price-source tag 1 is reserved since.
