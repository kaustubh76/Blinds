# Pyth in THE WINDOW

Pyth is not a price widget on this desk. It is a coefficient inside the proof that lets a loan exist.

## Where the number does work

**The solvency proof.** A borrower locks collateral by proving, over Token-2022 confidential ciphertexts,
that `collateral × price × multiplier ≥ haircut × loan` without revealing either amount. The program
forms `E_Δ = k_c·E_c − k_l·E_ℓ` with curve syscalls, where

```
k_c = price_scaled(price, expo) × multiplier     price in cents × the ScaledUiAmount multiplier
k_l = haircut_bps / 100                          150 for a listed stock, 200 for a pre-IPO token
```

and then consumes an equality proof plus a 64-bit range proof that `E_Δ` encrypts a non-negative value
(`programs/window_credit/src/instructions/lock_collateral.rs`, mirrored in `sdk/src/solvency.ts` and
`crates/window-proofs/src/scalar.rs`). `price` is the Pyth quote in the listing's `PriceCache`. No quote,
no `k_c`, no proof, no loan.

**The seizure gate.** `seize` is permissionless once a loan matures — but only against a fresh price.
A stale quote cannot seize: safety degrades to inaction (`lifecycle.rs`).

**The mark on the dashboard.** The Market page shows what the desk marks with, next to what the
underlying equity is doing.

## Which feeds, and why two

| Feed | Role | Schedule |
|---|---|---|
| `Crypto.TSLAX/USD` (`0x47a15647…a362`) | the collateral mark for `TSLAx-mock`, listing #0 | 24/7 |
| `Equity.US.TSLA/USD` (`0x16dad506…32f1`) | the underlying, shown beside it with the **wrapper basis** in bp and the NYSE session state | 09:30–16:00 ET, Mon–Fri |

The overnight window opens exactly when the equity market closes. That is why the wrapper feed — the
one that keeps publishing through the night and the weekend — is the mark, and why the equity feed is
shown for comparison rather than used for margin.

## How the quote reaches the chain

```
Hermes (pyth.dourolabs.app, Authorization: Bearer $PYTH_API_KEY)   ── primary, keeper-side only
   └─ falls back to ─▶ Pyth's own PriceUpdateV2 accounts on mainnet: push-oracle PDAs
                         [shard 0 | shard 1, feed_id] under pythWSns…, plus the profile's account;
                         owner == rec5EK… (the receiver), feed_id == the listing's; freshest wins
keeper ── post_price(listing, price, expo, publish_time) ──▶ PriceCache ["price", feed_id]
                                                              publish_time stored unmodified
```

`window-admin price-check` prints every listing's source, mark and quote age without sending anything;
`/metrics` exposes `window_price_publish_age_seconds{listing="…"}`.

### The second path: Pyth's own account, read by the program (`price_source = 4`)

```
Hermes (signed VAA, bearer key) ── services/pyth-poster ──▶ Pyth receiver on devnet (rec5EK…)
                                                              verifies the guardian signatures, writes
                                                              PriceUpdateV2 at [shard 7001, feed_id] = JBDgVnqW…
lock_collateral / seize ── quote::read_quote(listing, account) ─▶ owner == rec5EK…, feed_id == listing's,
                                                              verification == Full, price > 0; then the same
                                                              two age rules on Pyth's publish_time / posted_slot
```

The keeper is not in this path. `PriceCache` is still what sources 0–3 read; a source-4 listing refuses the
cache PDA (`BadPriceAccount`), and a cache-priced listing refuses a Pyth account. The listing is flipped by
`window-admin listing-set-source mock_tsla 4`, which first reads the devnet account and refuses while it is
missing or older than the listing's limit — so the flip can never strand the listing. The poster runs from
`scripts/market.sh start` whenever `PYTH_API_KEY` is set (`/tmp/window-pyth-poster-devnet.log`), one post per
minute (≈ 0.00001 SOL each, the PDA's rent once). `price-check` prints the devnet account's age beside the
Hermes read.

## What the chain enforces

Two rules, both at `lock_collateral` and `seize`, per listing (`Listing.max_price_age`,
`Listing.max_publish_age_secs`):

1. `slot − price.posted_slot ≤ max_price_age` — the keeper is alive (`PriceStale`).
2. `now − price.publish_time ≤ max_publish_age_secs` — **the quote itself is recent** (`QuoteStale`).

`post_price` also refuses a `publish_time` more than 60 s in the future (`PublishTimeAhead`) and a
regression. The keeper posts whatever the source published, with its true timestamp; the chain decides
whether it is usable. For `TSLAx-mock` the limit is one hour — on a 24/7 feed an hour-old quote is a
broken feed, not a closed market.

## The incident, recorded

The mainnet push account this deployment first copied from (`GpoWLTd6…`, `Crypto.TSLAX/USD`, shard 0)
stopped being updated on **2026-09-12 12:18 UTC**. Until 2026-09-17 the keeper re-posted that quote with
a fresh `posted_slot`, and the slot-based rule could not tell: the desk marked collateral on a five-day-old
price. The fix is the two-source keeper above and rule 2 on chain — a freshly *posted* old quote is now
refused by the program (`tests/attacks/attack_07_stale_price.rs::stale_quote_is_rejected_even_when_freshly_posted`).
Earlier documentation called `Crypto.TSLAX/USD` "an equity feed that stops overnight"; that was wrong — the
account died, not the feed.

## Honest limits

- Under source 0 the keeper is a trusted copier: the program checks the quote's age and feed id, not Pyth's
  signature. Under source 4 the program reads the account Pyth's receiver wrote after verifying the guardian
  signatures; what it does not do is verify a VAA itself (that is the receiver's job, on the same cluster).
  The desk's poster is still the party that *carries* the update onto devnet, and can only be late, never
  wrong: a stale account fails rule 2. Status of the devnet flip: `docs/TRACKS.md`, Stage 4.
- Tessera and PreStocks listings are marked by their public APIs, not by Pyth, and their `publish_time`
  is the keeper's fetch time — attested, and labelled as such everywhere.
- `Equity.US.TSLA/USD` is read in the browser from a browser-friendly mainnet RPC (`solana-rpc.publicnode.com`
  by default); the public `api.mainnet-beta` answers 403 to browser origins.

## Tests that pin this down

- `services/admin/src/price.rs`: Hermes parse and feed-id check, push-oracle PDA vectors
  (`GpoWLTd6…` = shard 0, `Exzs9zru…` = shard 1, `FQB8c4zB…` = TSLA shard 1), account decode against a
  captured mainnet `PriceUpdateV2`.
- `tests/attacks/attack_11_pyth_account.rs`: a `Full` receiver-owned update locks and seizes; wrong owner,
  `Partial`, a cache PDA on a source-4 listing and a Pyth account on a cache listing → `BadPriceAccount`;
  another feed → `WrongFeed`; past the limit → `QuoteStale`, at the limit accepted.
- `app/src/lib/pyth.test.ts`: the same decoder in TypeScript, the same PDA vectors, the NYSE session
  boundaries, the basis arithmetic.
- `tests/attacks/attack_07_stale_price.rs`: stale post, stale quote (freshly posted), future quote.
- `crates/window-proofs`, `sdk/test/solvency.test.ts`: `k_c` / `k_l` scaling and the scalar soundness bound.
