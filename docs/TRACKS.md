# Track integration — Pyth · PreStocks (· Meteora DBC · Clawpump, from 21 Sep)

Diagram: [`docs/tracks.excalidraw`](tracks.excalidraw) (open at excalidraw.com or with the VS Code Excalidraw
extension). Deadline: **Fri 26 Sep 2026**. This file is the integration record: what each sponsor judges, what in
the desk answers it, which stage delivers it, and what we do not claim. It is updated at the end of every stage.

## Tracks chosen, and why

| Track | Prize | Why it fits a private margin desk | Not chosen |
|---|---|---|---|
| **Pyth — best use of market data** | 3 months Pyth Pro | Pyth already *is* the collateral mark: its price is the `k_c` scalar inside every solvency proof and the gate on every seizure. The work makes it fresh, comparable (underlying vs wrapper) and enforced on chain. | — |
| Tessera — pre-IPO T-Tokens | $6,000 | | **Dropped 21 Sep.** PreStocks' rule: "projects that integrate any non-PreStocks pre-IPO tokens will be ineligible". The desk had listed `T-OpenAI` next to `ANTHROPIC`; it cannot hold both bounties. The `T-OpenAI-mock` listing was **retired** on chain (`update_listing`: haircut 1,000,000 %, quote limit 1 s, symbol `RETIRED`; a listing cannot be closed) and removed from the profile, descriptor, keeper, SDK, dashboard and diagram. Its open loans still repay. |
| **PreStocks — pre-IPO tokens** | $10,000 | PreStocks' `ANTHROPIC` token and its published mark price become a collateral of the desk: wrap, prove `collateral ≥ 200 % × loan` against the mark without revealing the position, borrow at the print. The only pre-IPO token on the desk (see Tessera). | |
| **Meteora DBC** | $5,000 | Taken up 21 Sep (Part B below): the desk's lender agent launches its token on a TSLAx-quoted DBC pool on mainnet, configured from the desk's own numbers. | |
| **Clawpump** | $5,000 | Taken up 21 Sep: the lender agent gets a Clawpump identity and wallet; the stock-paired pool is the Meteora one. | |

## What the desk becomes: one rate, a collateral schedule

Today `window_credit` accepts one collateral (the mock TSLAx) priced by one feed, both frozen in `Config` at
`initialize`. The upgrade is **additive**: a `Listing` account per eligible collateral, each with its own price
source, haircut and freshness limits; the xONIA rate, the sealed-bid window and the proofs are untouched.

```
Listing ["listing", cstock_mint]  { mock_mint, cstock_mint, escrow_account, feed_id[32],
                                    price_source (0 Pyth cache · 1 reserved/retired · 2 PreStocks · 3 mock · 4 Pyth's own account),
                                    haircut_bps, max_price_age (slots), max_publish_age_secs, symbol[16], decimals }
PriceCache ["price", feed_id]     { feed_id, price, expo, publish_time, posted_slot, posts }   — one per listing
Loan.listing                      bound at lock_collateral; deposit / seize / release check it
```

Two freshness rules, both on chain, checked at `lock_collateral` and `seize`:

1. `slot − posted_slot ≤ listing.max_price_age` — the keeper is alive (existed before).
2. `now − price.publish_time ≤ listing.max_publish_age_secs` — **the quote itself is fresh** (new). The keeper
   posts what the source published with its true timestamp; the chain decides whether it is usable.

Where the quote is read from is the listing's choice (`programs/window_credit/src/quote.rs`): sources 0–3 read
this program's `PriceCache` PDA; source 4 reads a **`PriceUpdateV2` owned by Pyth's receiver program** on the
same cluster — owner, feed id and `Full` verification level checked, then the same two rules on Pyth's own
`publish_time` and `posted_slot`. For that listing the keeper is out of the price path entirely.

Planned devnet schedule:

| Listing | Source | `feed_id` | Haircut | Quote limit |
|---|---|---|---|---|
| `TSLAx-mock` | Pyth `Crypto.TSLAX/USD` via Hermes (bearer key), on-chain push account as fallback | `0x47a15647…a362` (Pyth id) | 150 % | 1 h |
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
| Pyth's own account on chain | `price_source = 4`: `lock_collateral` / `seize` read a receiver-owned `PriceUpdateV2` (owner `rec5EK…`, feed id, `Full`) — the price Pyth's guardians signed, verified by Pyth's receiver, never copied by the keeper. `services/pyth-poster` carries the Hermes VAA onto devnet (shard 7001 → `JBDgVnqW…`); `window-admin listing-set-source mock_tsla 4` flips the listing only once that account is fresh. | 4 |

Incident recorded honestly: the mainnet push account `GpoWLTd6…` we copied from **stopped updating on Sat 12 Sep
2026 12:18 UTC**; until Stage 1 the desk marked collateral on that quote and the slot-based rule could not see it.
`Crypto.TSLAX/USD` is a 24/7 feed (earlier docs called it an equity feed that closes overnight — wrong; the push
account died, the feed did not).

## Tessera — retired 21 Sep

Listed 17–20 Sep as `T-OpenAI-mock` (`BAUiqw…`, escrow `AmL991…`, cSTOCK `GRDt32…`), verified end to end (rows below
are kept as history). Retired for PreStocks eligibility: `window-admin listing-retire tessera_openai` set the on-chain
listing to haircut 1,000,000 % / quote limit 1 s / symbol `RETIRED` (every future lock and seize refused; repay →
release unaffected), removed it from `deployments/devnet.json` and `config/devnet.toml`, and moved its agent to
listing #0. The keeper no longer posts under `sha256("tessera:T-OpenAI")`; price-source tag 1 is reserved.

## PreStocks — criteria → what answers them

| Judged on | Where it is answered | Stage |
|---|---|---|
| Creativity | The same desk lists `ANTHROPIC` next to a listed stock under one rate — a collateral schedule, the way a prime desk actually runs; and (Part B) the desk's lender agent, whose yield comes from loans against tokenized stocks, is launched on a stock-quoted Meteora pool. | 3 |
| Integration depth | `/api/prestocks` `markPrice` → keeper → `PriceCache` (`price_source = 2`). The implied price (`tokenPrice`) is read beside it and served by the admin's `GET /marks` (22 Sep; never on chain — PreStocks' API sends no CORS header and `post_price` needs a listing): the **PreStocks mark card** on the Market page (`#/market/prestocks`) shows mark, implied price and the basis in bps while the market runs, and says what it waits on when it does not. | 3 |
| Product quality | The **PreStocks** tile in Home's "built with" strip (live mark) and the PreStocks mark card on Market (mark, implied, basis, haircut, the 48 h rule's verdict, the mainnet mint `Pren1…`); listing selector on the Desk, per-listing lock/deposit on Positions, schedule with quote ages on Market; tier-1 attack cases for wrong-listing and stale-quote paths; tier-2 lifecycle on a second listing. | 3 |
| Developer surface | Build page: the `ANTHROPIC-mock` schedule row, the **PreStocks** column (`feedIdForLabel("prestocks:ANTHROPIC")`, the `/api/prestocks` `curl`, the same SDK calls), `marks` and `solvency` recipes (ANTHROPIC: 1.965 shares required, 3.143 pledged after the 200 % haircut for 1,000 USDC); console events named by listing (`credit.PricePosted · ANTHROPIC-mock $…`). | live |

## Part B — the lender agent: Meteora DBC + Clawpump (21 Sep)

The desk's lender is an autonomous agent. On devnet it already lends every overnight window against
tokenized-stock collateral proven solvent in zero knowledge and earns the xONIA rate (`services/admin`, the
simulated agents). Part B gives it a token and an identity: **`WLEND`** launches on a Meteora Dynamic Bonding
Curve **quoted in a tokenized stock** (TSLAx on mainnet, a twin mint on devnet), and the curve is configured
from the desk's own numbers rather than from a template. Code: `services/launch` (`plan · launch · status ·
buy · graduate · agent`), `sdk/src/dbc.ts` (the pool decoded from raw bytes), `app/src/features/market/LenderAgent.tsx`.

What "configured from the desk's numbers" means (`services/launch/src/plan.ts`, `buildCurveWithMarketCap`):

| Curve parameter | Set from | Value |
|---|---|---|
| quote token | the desk's collateral | TSLAx `XsDoVfqe…zoB` (8 dp, Meteora-badged) on mainnet; twin `GY41SK2W…qhbn` on devnet |
| initial / migration market cap (in quote units) | USD targets ÷ Pyth's price of the quote stock — **the same read the desk marks collateral with** (`Crypto.TSLAX/USD` from Pyth's own mainnet account; `Equity.US.TSLA/USD` while the wrapper's account is stale, recorded as `quote.feed`) | $25,000 → $250,000 fully diluted; at $367.50 that is 68.03 → 680.27 quote, threshold 167.46 quote raised |
| fee schedule | one **tenor** of the desk (a loan lives ~4 h on devnet): 300 bp at the first tick decaying exponentially to 30 bp over 48 periods | `FeeSchedulerExponential`, dynamic fee on, fees collected in the quote stock |
| creator | the lender agent's wallet (Clawpump's `walletAddress` once `agent` has run; the payer until then) | 50 % of trading fees + 10 % of the graduated raise to the agent |
| graduation | DAMM v2, `Customizable` config, both LP positions permanently locked | `LAUNCH_DAMM_CONFIG` = `7F6dnUcR…NESd` |
| supply | 1,000,000,000 WLEND, 6 dp, no vesting | — |

### Meteora DBC — criteria → what answers them

| Judged on | Where it is answered |
|---|---|
| Originality of the DBC use case | A **stock-quoted** curve for an agent whose yield comes from loans against that stock class; the raise target and the fee horizon are the desk's own (USD lending capital priced through Pyth, one tenor). Not a memecoin launcher and not a Pyth-anchored stock/stock pool. |
| Technical soundness | `createConfigAndPool` from the SDK (`@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12) with the token badge passed when the quote has one; `tokenSupply` left to the program when a migration fee is set (the program's `InvalidTokenSupply` rule); creator-fee percentage tied to the migration fee (the program's other rule). The dashboard reads the pool **without** the SDK: `sdk.fetchDbc` decodes `VirtualPool` / `PoolConfig` from bytes (owner-checked against `dbcij3LW…`), with fixtures captured from the devnet pool. |
| Working code on mainnet | Devnet rehearsal done end to end (below). The mainnet launch is one command once the launch key holds ~0.05 SOL (`launch` checks the balance first and sends nothing below 0.04) — the tool refuses to price it on a Pyth quote older than 3 days. |
| Life after the hackathon | `status`/`graduate` are operator commands; the Market card and the `launch-status` recipe follow whichever cluster the record names; the fee stream and the locked LP outlive the event. |
| Product surface | The **Agent** page (`#/agent`, 22 Sep): the journey (five steps, each computed from the records and the pool, every pending one naming what it waits on), the agent on the desk (lender/borrower agents, last xONIA), the Meteora card (fee now with the schedule drawn, progress, fees), "the curve, set from the desk's numbers" (parameter → desk number → on-chain value), the Clawpump identity, the developer column. Home's "built with" strip links to it with the live progress. |

### Clawpump — criteria → what answers them

| Judged on | Where it is answered |
|---|---|
| An agent, launched with a stock-paired pool | The lender agent is a real actor of the desk (it quotes every window). `services/launch agent` gives it its Clawpump identity — the key's one agent is reused and renamed (`POST /agents/{id}`), else created — and records `id` + `walletAddress`; that wallet is the Meteora pool's **creator and fee claimer** by default, and the card checks the chain agrees ("fees flow to the agent"). `services/launch clawpump-launch` has Clawpump launch the agent's **identity coin `LENDER` on pump.fun, paired with TSLAx** (`POST /launch`, `pumpQuoteMint` = TSLAx, `selfFunded` — the agent's own wallet pays 0.0092 SOL). |
| Where a judge sees it | The Agent page's Clawpump card (name, id, wallet on mainnet, the coin's pump.fun/mint/tx links once launched) and the journey's steps 1 and 4; the Home strip's Clawpump tile. |
| Two coins, two roles | Clawpump's launch venue is pump.fun (confirmed 21 Sep from its developer reference: `/launch`, `/launch/self-funded`; `/pump-pairs` lists TSLAx and 21 other xStocks); it cannot create a Meteora pool, and a DBC pool mints its own token. So the agent has an identity coin (Clawpump → pump.fun, TSLAx pair) and a capital token (WLEND on Meteora, configured from the desk). One agent, one revenue wallet; the card and the docs say which is which. |

### Verified on devnet, 21 Sep 2026

| step | evidence |
|---|---|
| plan | priced from Pyth's mainnet account; `Crypto.TSLAX/USD` shard 0 was 754,853 s old, so the plan records `Equity.US.TSLA/USD` (13 s old) — $367.50 → threshold 167.46 quote |
| launch | `createConfigAndPool` `5aadUBpt…AmmP`: config `HsfeZeTw…GPZr`, pool `EZyMqXWB…6BTg`, WLEND mint `72QJmsn4…ZL1m`, quote twin `GY41SK2W…qhbn`, creator `8S6dkUV5…wHf5` (`deployments/launch-devnet.json`) |
| buy 5 | progress 2.9 %, raised 4.85 quote, fees 0.06 creator / 0.06 partner, spot 7.72e-8 quote per WLEND |
| the same numbers from raw bytes | `sdk/test/dbc.test.ts` (3) against the captured accounts; the Market card and the Build page's `launch-status` recipe on the dev server show 2.9 % / 4.85 of 168.50 quote / $28k fully diluted |
| unit tests | `services/launch/test/plan.test.ts` (6): USD → quote conversion, the raise scales with the quote price, fee/lock/agent slice, refuses nonsense, and which Pyth read prices the quote |

Still open (needs inputs, not code): ~0.05 mainnet SOL to the launch keypair and ~0.02 to the Clawpump agent
wallet (the key is in place). Then: `agent` → `LAUNCH_CLUSTER=mainnet launch` → `clawpump-launch` → commit
`deployments/launch-mainnet.json` → re-render DEMO (`docs/RUNBOOK.md` §6).

## Honest limits (also in the UI)

- The PreStocks mark is a **keeper-attested** copy of a public API, timestamped at fetch. It is not a
  signed feed. The Pyth listing is the only one whose quote carries the publisher's own timestamp (and, after
  Stage 4, the publisher's own signature).
- The administrator can decrypt individual amounts (accountable privacy — unchanged; see `docs/THREAT_MODEL.md`).
- Devnet twins, not the mainnet tokens.
- The lender agent's pool and fees are real on the cluster named on the card; the lending loop the agent earns
  from is the devnet desk. Clawpump's own launch venue is pump.fun; the stock-paired pool here is Meteora's.

## Stages and status

| Stage | Delivers | Status |
|---|---|---|
| 0 | This record + `docs/tracks.excalidraw` | done 17 Sep |
| 1 | Keeper: Hermes with key, freshest on-chain shard fallback, `price-check`, quote-age metric, doc corrections | done 17 Sep (Hermes path live once `PYTH_API_KEY` is set) |
| 2 | Dashboard: underlying vs wrapper panel (Pyth mainnet read via a browser-friendly RPC), wrapper basis, stale badge | done 17 Sep (`app/src/lib/pyth.ts`, `CollateralMark.tsx`) |
| 3 | `Listing` upgrade of `window_credit` (+ `migrate_loan`), per-listing keeper sources (Tessera, PreStocks), SDK/app selectors and schedule, tier-1/2 tests, devnet upgrade with three listings | done 17 Sep — tier 1 green, tier 2 15/15, devnet upgraded (programdata +33,125 B; listings `5pJXoG…` TSLAx, `BAUiqw…` T-OpenAI (retired 21 Sep), `4qQ4A9…` ANTHROPIC; 65 loans migrated) |
| 4 | The Pyth listing reads Pyth's receiver-owned account on chain: `quote.rs`, `price_source = 4`, `BadPriceAccount`/`WrongFeed`, `attack_11` (7 cases), SDK `fetchQuotes`/`decodePriceUpdate`, `services/pyth-poster`, `listing-set-source`, poster wired into `market.sh` | program + poster done 18 Sep; **devnet upgraded to A15** (`window_credit` slot 500375381, `e2c2dbb`); only the TSLAx flip (`listing-set-source mock_tsla 4`) waits for `PYTH_API_KEY` — the poster needs Hermes; until then TSLAx stays source 0 and honestly stale, and every dashboard surface already reads a source-4 listing where the program would (`fetchQuotes`) |
| 5 | `docs/PYTH.md`, `docs/LISTINGS.md`, README, submissions, market restart, freeze + tag | docs written 17 Sep; **verified on devnet 18 Sep** (below); `docs/RUNBOOK.md`; hosted site back on GitHub Pages 19 Sep (repo public); submission blurbs final (below); freeze + tag are the last action, on the user's go |
| 6 | Part B: `services/launch`, `sdk/src/dbc.ts`, the Market card, `launch-status` recipe, RUNBOOK §6 | devnet rehearsal verified 21 Sep; mainnet launch + Clawpump agent wait for the two inputs above |

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

## Re-verified on the hosted site at A15, 19 Sep 2026

Same path, now on **https://kaustubh76.github.io/Blinds/** (Pages back up: repo public, first real CI runs) against
the A15 program (deployed bytes == `anchor build` of HEAD, all five programs) with the live keeper and agents:

| step | evidence |
|---|---|
| tier 1 · tier 2 on HEAD | `cargo test --workspace`: 32 attack cases, 6 e2e, 3 invariants, 2 measurements, 2 privacy, all crates — green (debug, ≈95 min); `make test-integration` 15/15 (198 s) |
| judge path, fresh burner `Hqj7…Qe5t` | Autopilot 16–30 s: faucet join `3B5FHeL5…` → confidential account → wrap → sealed borrow bid; matched in epoch 429 (`W1oS…myiH`, 4.00 %, T-OpenAI-mock); inline derive on Positions → `lock_collateral` with the priced proof `5rt6znKC…` (price at lock $812.79, 200 %) → confidential transfer + `deposit_collateral` `2YF8VmDJ…` |
| every route, every wallet-free recipe | zero page errors on `#/` `#/desk` `#/positions` `#/market` `#/explorer` `#/build`; `config` `schedule` `pyth-mainnet` `marks` `solvency` `latest-print` `verify` `subscribe` all confirmed (verify re-proved epoch 398 in the browser) |
| live events | `credit.PricePosted · T-OpenAI-mock $812.79`, `· ANTHROPIC-mock $1,018.91`, `· TSLAx-mock $365.23`, `credit.LockRequested · ANTHROPIC-mock` decoded over the WebSocket on the hosted build |

Found and fixed (19 Sep): the agents quoted only every second or third window — the loan-service pass
outlasted windows on the public RPC (one borrower per tick, one loan per pass, the listing's quote read
once, wallet top-ups; `48b3937`, `e5cda31`); the Autopilot's bid *at* the last print was marginal and
missed the print in three epochs (now 50 bp past it; `f08e5a1`); the burner did not reconnect after a
reload (`530f109`); Positions sent the borrower back to the Desk for a signature (`9469abd`); the Build
page, the Market's Pyth card and the header read the keeper's cache even for a source-4 listing
(`1a4373a`: every reader resolves the account the program reads).

## 20 Sep: hosting back, CI green on Linux, one more lock rule

- GitHub Pages recreated and live again; CI runs. The Linux tier-2 failure was the **prebuilt x86_64
  `solana-test-validator`** refusing valid pubkey-validity proofs (`window-admin zk-probe`: the macOS-made proof
  is refused there too; a source-built validator on the same runner accepts both) — CI builds it from source.
- `sdk.lockCollateral`: read the quote where the program reads it, prove, send, and on `DeltaMismatch` (the keeper
  reposted mid-lock) close the attempt's contexts and prove once more. Tier 2 3/3 green after it; the tests and
  the dashboard lock this way. `confirmSignature` no longer crashes on a confirmed-but-failed transaction.
- Judge path on Pages, third listing: burner `Eqso…wiLZ` → Autopilot → matched epoch 470 → lock at $1,030.63
  (ANTHROPIC, 200 %) → deposit `fMwX…gUVs`. Agents read their collateral balance from the account (a release
  had drifted the memory file); `watch_tunnels.sh` keeps the quick tunnels alive.

- Final integration pass (20 Sep evening), every check at HEAD on the hosted site: Pages == HEAD, chain == HEAD
  (5/5 byte-identical), `price-check` answers for Pyth (refused, stale by design) / Tessera (since retired) / PreStocks, all eight
  wallet-free recipes confirmed on Pages (`verify` re-proved epoch 470 in the browser), `thewindow.schedule()`,
  fresh public clone builds and tests green, CI green. The pass surfaced one more agents gap — a loan whose deposit
  failed after the lock was never resumed, and the deposit itself failed on a stale owner-side balance cache
  (`InconsistentInput`) — fixed (`4946808`): 9 stranded deposits resumed in one window, 0 failures after.

## Submission blurbs (final)

**Pyth.** THE WINDOW is a private margin desk for tokenized stocks. Pyth is not a widget on it — it is a
coefficient in the proof. Every loan is backed by a zero-knowledge statement `collateral × price ≥ 150 % × loan`
where `price` is Pyth's quote, so without a fresh Pyth price no collateral can be locked and no position seized.
We read Hermes with a key, fall back to Pyth's on-chain accounts, enforce the quote's own `publish_time` on chain
per listing, and show the xStock quote against the underlying equity feed with the basis, because the overnight
window opens exactly when the equity market closes. The Pyth listing can run with no keeper in the price path at
all: the program reads Pyth's receiver-owned `PriceUpdateV2` directly (owner, feed, verification level, age),
posted onto devnet from Hermes by our own poster (`price_source = 4`, deployed; the devnet listing flips to it the moment a Pyth key is present).

**Meteora DBC.** THE WINDOW's lender is an autonomous agent that lends against tokenized stocks every
overnight window and earns the xONIA rate. Its token, WLEND, launches on a Dynamic Bonding Curve **quoted in
TSLAx**, and the curve is set from the desk's numbers: the raise target is the agent's lending capital in USD,
converted into the quote stock through the same Pyth read the desk marks collateral with; the fee decays over
one tenor of the desk; the creator fee stream is the agent's wallet; graduated liquidity is locked for good.
The dashboard reads the pool from raw bytes (no SDK in the browser) and shows progress, raise, fees and spot
beside the desk's own schedule. Devnet rehearsal verified end to end; the mainnet pool is one command.

**Clawpump.** The lender agent gets a Clawpump identity and wallet; that wallet is the creator and fee claimer
of its stock-paired Meteora pool. Everything the agent earns — trading fees, its share of the raise, and the
xONIA it lends at — flows to one address a judge can watch.

**PreStocks.** ANTHROPIC, the only pre-IPO token on the desk, listed next to a tokenized stock under one rate, marked by PreStocks' published price with
its implied-vs-mark basis on the Market's PreStocks card: wrap, prove `collateral ≥ 200 % × loan` against the mark without revealing
the position, borrow at the print, and — for developers — a Build page that shows the listing's PDAs, the account
the program prices from, and the exact SDK calls, runnable in the tab.
