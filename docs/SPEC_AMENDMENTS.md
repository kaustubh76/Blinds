# THE WINDOW for Stocks — Specification Amendments

**A record, section by section, of what changed between the frozen specification
([`SPEC.md`](SPEC.md), 15 Sep 2026) and what is being built — and the evidence behind each change.**

Tagline: *The rate is public. The price is public. The position never was.*

One-line explanation: the spec froze the mechanism before code; this document is the written-amendment
log the spec itself requires ("§7 and §12 change only by written amendment noted in the README"), plus the
engineering decisions that turn the spec into a fresh, independent, verified Solana build.

Amendment ids (A1–A14) are referenced from `README.md`, `docs/BUILD_PLAN.md`, code comments and tests.

---

## 1. Executive Summary

**Unchanged in substance.** Core problem, control loop and objective stand as written.

**Changed:** the build is a *fresh* Solana implementation. Nothing — no code, fixtures, tests, service
loops or documentation — is taken from the earlier Avalanche project the spec cites as lineage (**A9**).
The spec's "adaptation of THE WINDOW" is now an adaptation of the *mechanism only*; every line of this
repository was written for Solana's primitives. A CI check (`scripts/check_lineage.sh`) enforces it.

## 2. The Central Research Question

**Unchanged.** Sub-question 1 (composition) is already answered *green* before Phase 1: the ZK ElGamal
Proof program (SIMD-0153) and curve25519 syscalls are active on devnet and mainnet, and the composition
— grouped ciphertexts → syscall accumulation → `ZeroCiphertext` proof-of-correct-decryption — was built
with the installed Anchor CLI and executed on SBF with real proofs (see §15). Sub-question 2 (priced
solvency) is answered in the same spike: the `CiphertextCommitmentEquality` + `BatchedRangeProofU64`
pair over `E_Δ` verifies on-chain, and an undercollateralized borrower cannot construct it.

## 3. Why the Name

**Unchanged.** Product name and *xONIA* are kept. The name is not claiming to be a Federal Reserve
product, a bank, a broker-dealer, or a regulated benchmark.

## 4. Why This Fits Stocklana

**Unchanged.** One addition to the execution-quality row: the privacy claim is now *tested*, not asserted
(§12, §15 below).

## 5. Connection to Official / Existing Ideas

**Changed:** the corporate-action multiplier is read from the Token-2022 **`ScaledUiAmount`** extension
on the (mock) xStock mint — the actual rebasing mechanism — rather than "mint metadata" (**A7**).
The spec's table row for "xStocks on Token-2022" now reads: multiplier = `ScaledUiAmountConfig.multiplier`
(effective at `new_multiplier_effective_timestamp`), folded into the public solvency scalar.

## 6. What Makes This Different

**Unchanged.** The comparison table stands. The "WINDOW on Avalanche" column remains as a *conceptual*
baseline only; no artefact of it is used (**A9**).

## 7. Core Mechanism

### 7.1 Observation / Input Capture

- **A2 — `Bid` accounts replace the per-member fill map.** Spec §11 had `Epoch.fills: Pubkey`
  ("companion PDA: per-member 74-bit fill map, closed at print"). A print transaction cannot enumerate and
  close one map per member, and the administrator needs each bid's ciphertext *from chain state* to post
  matches (not from RPC transaction history, which is not consensus data). Each bid is now its own PDA
  `["bid", epoch, member, side, tick]` holding the 96-byte grouped ciphertext; the account's `init` is
  the one-bid-per-member/side/tick/epoch guard; rent is reclaimed by a permissionless `close_bid` after
  the epoch settles.
- **A4 — Wrap follows Token-2022 as it is.** The spec said wrap "mints cSTOCK-W 1:1 into the member's
  confidential *pending* balance; the member applies it with the standard native proof." In Token-2022,
  `MintTo` credits the public balance; the owner-signed `Deposit` instruction moves public → pending with
  **no proof**; `ApplyPendingBalance` needs no zero-knowledge proof either (only the owner's new
  AE-encrypted decryptable balance). `wrap` therefore does `transfer_checked` (mock → custody), `mint_to`,
  and a CPI `Deposit` with the member's signature propagating; the client applies the pending balance.
- Bid submission is unchanged in substance: `(side, tick)` public, grouped ciphertext with two handles,
  `GroupedCiphertext2HandlesValidity` + `BatchedRangeProofU64` on `(s − s_min)` with bit lengths
  `[40, 24]` (the second commitment is a random-opening commitment to zero; the proof program rejects
  identity commitments). Verified sizes: validity 320 B (inline in the `submit_bid` transaction), range
  936 B (its own transaction into a context-state account).

### 7.2 Delayed / External Signal

- **A1 — The print is batched.** `finalize_print(epoch, claimed_sums[74], r*)` consuming 0–74 proof
  contexts cannot fit a 1,232-byte transaction (74 account keys alone are 2,368 bytes). The print is now
  `begin_print` → `attest_ticks` × N → `finalize_print`. Each `attest_ticks` transaction carries up to
  `attest_batch` inline `VerifyZeroCiphertext` instructions (192 B each) and the program reads them through
  the Instructions sysvar; binding is recorded in `Print.proven_bitmap`. Measured: four inline proofs are
  954 B before the consuming instruction, so the default batch is **3** (four if the measured full
  transaction stays under the limit; v0 + address-lookup tables are the path to five). Worst case
  (74 nonzero ticks) is 2 + 25 transactions with batch 3; the spec's "≤ 16 tx" target holds for ≤ 42
  nonzero ticks at batch 3 (≤ 56 at batch 4) and is **reported as measured**, not assumed.
- "Contexts consumed and closed at finalize" no longer applies to PoCD proofs: inline proofs create no
  context accounts. Bid and solvency contexts *are* closed by CPI at consumption.
- Validation rules (coverage, bound, recompute, uniqueness, freshness) are unchanged; recompute uses the
  single `window-clearing` implementation on-chain and off-chain.

### 7.3 Core Calculation

- **A3 — Solvency units corrected.** The spec's bound `100·p·a·2^40 < 2^63` with `c < 2^40` forces
  `100·p·a < 2^23`, which no realistic price satisfies. Units are now:
  `c` in **milli-shares** (`< 2^32`), `ℓ` in micro-USDC (`< 2^40`), `p′` = price in cents
  (`price · 10^(expo+2)`), `a` = multiplier · 10^3. Value in micro-USDC is `c·p′·a / 100`, so the 150 %
  test is `c·p′·a ≥ 150·ℓ` and the scalars are **`k_c = p′·a`, `k_l = 150`** (the spec's
  `(100·p·a, 150·b)` with `b = 100`, divided by the gcd). Soundness: `k_c·2^32 < 2^63` and
  `k_l·2^40 < 2^63`, so an honest `Δ` is provable as a u64 while a negative `Δ` wraps to ≈ 2^252 and the
  U64 range proof rejects it. Verified on-chain with TSLA-like numbers (c = 1,000.000 shares,
  p′ = 40,012, a = 1,000): a 200,000 USDC loan proves; a 300,000 USDC loan cannot be proven.
- **A6 — Loan ciphertext.** `Loan.size_ct` is a 2-handle grouped ciphertext (borrower, auditor). For a
  full fill it is *copied from the `Bid` account and program-enforced equal*; for a bid split across
  lenders the administrator posts a fresh ciphertext with a validity proof binding it to the borrower's
  and auditor's keys. Because `matched = D(r*)`, **bids are always fully filled; only asks at the marginal
  tick are pro-rated**, so the borrower's loan equals its bid unless it is split. Lenders learn ℓ from the
  administrator (disclosed trusted surface, unchanged).
- The clearing rule and the pro-rata rule are implemented from the formulas in this section with
  hand-computed fixtures and a brute-force property test (`crates/window-clearing`). The marginal tick is
  defined precisely as `min { m ≤ r* : S(m) ≥ D(r*) }`; asks below it fill fully, asks at it fill at the
  disclosed ratio, asks above it get nothing.

### 7.4 Aggregation / Epoch Logic

**Unchanged**, plus `Epoch.auditor_pubkey` stamped at `open_epoch` so a key rotation between epochs is
bound to the epoch that used it (**A8**).

### 7.5 Controller / Decision Rule

**Unchanged.** Parameters live in `config/{demo,integration,prod}.toml` — one source read by the setup
scripts, the admin service and the tests. Added: `integration` profile (20-slot epochs) for real-validator
tests; `attest_batch`, `bsgs_baby_bits`, `bsgs_max_bits`, `collateral_bits`, `price_exp`, `mult_exp`.
The regime logic (`stale`, τ, BandEdge) is one pure function, `window_clearing::regime::step`.

### 7.6 Controlled Decay / Hysteresis

**Unchanged.** `Print.status ∈ {Attesting, Missed, Printed, NoTrade}` makes "missed-print recovery"
explicit: `mark_stale` (permissionless after `stale_after_slots`) steps the regime; a late
`finalize_print` is still allowed from `Attesting | Missed`.

## 8. Why the Off-Chain Administrator and the ZK ElGamal Proof Program Are Essential

**Unchanged in argument.** Two corrections to the causal chain:

- **A5 — Escrow signer reality.** "operator ──confidential transfer to escrow──▶ confirm_lock" is not
  possible: only the source account's owner can sign a Token-2022 confidential transfer. The borrower
  transfers into the operator's escrow account. As a cheap trust reduction, the borrower sends
  `[CT Transfer, deposit_collateral]` in one transaction and `deposit_collateral` verifies through the
  Instructions sysvar that the preceding instruction is a Token-2022 confidential `Transfer` from the
  borrower's cSTOCK-W account to the configured escrow → `Deposited`; the operator's `confirm_lock`
  moves it to `Locked`. The *amount* stays attested (§14); the *existence* of the transfer becomes
  program-verified.
- `mark_printed` cannot verify a CPI caller through the Instructions sysvar (it sees only top-level
  instructions). The oracle signs the CPI with its `["authority"]` PDA and the auction requires that signer.

## 9. Smart Contract Architecture

- Program set unchanged: `window_registry`, `window_wrap`, `window_auction`, `window_oracle`,
  `window_credit`. Program IDs are fixed at Phase 0 and identical on localnet and devnet.
- Oracle instruction set: `begin_print`, `attest_ticks`, `finalize_print`, `mark_stale` (**A1**).
- Auction adds `close_bid` and `rotate_auditor` (**A2**, §12 rotation).
- Credit adds `deposit_collateral` (**A5**) and reads the multiplier from the mint (**A7**).
- `Epoch` and `Print` are zero-copy accounts; `Option<u8>` became `outcome: u8 + r_star_tick: u8` (**A8**).
- Mathematical crates: `window-elgamal`, `window-clearing`, `window-proofs` as specified, plus
  `window-config` (parameters) and `window-testkit` (LiteSVM harness). `window-clearing` is `no_std` and
  is *the* implementation the oracle program runs; `window-proofs::scalar` is compiled into
  `window_credit` so the solvency scalars are literally the same code on both sides.
- The read-only lens is `@thewindow/solana-sdk` on `@solana/kit` with codama-generated clients from the
  frozen IDLs, and a `window-proofs-wasm` build for in-browser proof generation and re-verification.

## 10. Repository Structure

**Changed:** `services/agents` and `services/indexer` are TypeScript, `services/admin` is Rust (as spec);
`tests/` is a Rust crate (`window-tests`) plus `tests/integration/` (TypeScript, real validator);
`config/` holds three profiles; `docs/` adds `SPEC_AMENDMENTS.md` (this file), `BUILD_PLAN.md`,
`toolchain.md`, `measurements.json`, `adr/`. Program keypairs are git-ignored under
`deployments/program-keypairs/`.

## 11. Risk / Control State

- `Epoch`: spec layout + `auditor_pubkey`, `total_bids`; no `fills` (**A2**, **A8**).
- `Print`: spec layout + `status`, `nonzero_bitmap`, `attested`, `missed`, `marginal_ratio`,
  `matches_posted`; `r_star_tick: u8` with `outcome` discriminant (**A1**, **A8**).
- `Bid` (new): `{epoch, member, side, tick, ciphertext[96], slot}` (**A2**).
- `Loan`: spec layout + `bid_tick`, `fill: Ratio`, `collateral_ct[96]`, `delta_commitment[32]`, `k_c`,
  `k_l`, `lock_slot`, `funded_slot`, `collateral_released`; statuses
  `Pending | Requested | Deposited | Locked | Active | Repaid | Defaulted` (**A5**, **A6**).
- `PriceCache`: spec layout + `posts`.
- `OracleState` (new): the regime state and the latest-rate view.

## 12. Required Security Properties

**Unchanged and extended.** Additions:

- Every consumed proof context is checked for owner, proof type **and** `context_state_authority`
  (the extraction helper does not check the authority), then closed by CPI with the user's signature.
- The privacy property is a *tested* requirement: no instruction takes a size; sizes exist only as
  ciphertext bytes; no event carries an amount; a leak-audit test scans all accounts, transactions and
  logs of a full epoch and two loans for every secret quantity (see §15).
- Upgrade authority is set to `None` at the submission tag, as specified.

## 13. Threat Model

**Unchanged rows**, plus:

| Threat | Mitigation |
|---|---|
| Borrower claims a collateral deposit that never happened | `deposit_collateral` verifies the preceding Token-2022 confidential `Transfer` instruction to the escrow (**A5**) |
| Attestation for the wrong epoch/tick/sum | `attest_ticks` recomputes the residual from the frozen accumulator and the claimed sum; a proof for any other `(epoch, tick, sum)` cannot match |
| Toolchain drift silently changes proof layouts | exact pins (`=1.1.2`, `=4.0.0`, …) and a permanent gate test that verifies the whole proof path on every CI run |

## 14. Honest Limitations

**Unchanged; two clarifications.**

- The **wrap/unwrap public token legs** are visible: a Token-2022 confidential `Deposit` credits from a
  public balance, so the amount a member onboards appears in that transaction (identical to funding a
  brokerage account). The position — what is bid, borrowed and pledged — is never derivable from it; the
  dashboard guides members to wrap once, in round size, ahead of bidding.
- The mock mint carries `PermanentDelegate` like real xStocks, so the issuer can claw custody. Documented.

## 15. Verification & Measurement Plan

**Extended with results obtained before Phase 1** (build machine, Anchor CLI 1.1.2, LiteSVM 0.10 running
Agave's program runtime and the real ZK ElGamal builtin):

| Path | Result | Measured |
|---|---|---|
| Two grouped bids → syscall accumulation → auditor decrypt | = Σ sizes | — |
| PoCD (`ZeroCiphertext` on residual) true sum / false sum | verifies / rejected | 192 B; 6,000 CU |
| Four inline PoCDs in one transaction | verifies | 954 B; 24,000 CU |
| Bid validity (2 handles), inline | verifies | 320 B; 6,400 CU |
| Bid range `[40, 24]` into a context-state account, then close | verifies; closed | 936 B; 111,000 CU; close 3,300 CU |
| Solvency pair over `E_Δ` (A3 units) | verifies; undercollateralized unprovable | equality 320 B / 6,400 CU; range 936 B / 111,000 CU |
| **Anchor program on SBF**: `submit_bid` (introspected validity + context-account range + curve syscalls + CPI close) | ✓ | 27–30k CU; 676 B tx |
| **Anchor program on SBF**: `attest` (introspected PoCD bound to the accumulator) | true ✓ / false ✗ | 16.7k CU; 480 B tx |

**Test tiers (new):** tier 1 on LiteSVM (attack tests 1–8, invariants, privacy, measurements); tier 2 on
a real `solana-test-validator` through the TypeScript SDK with the real admin/agent binaries; tier 3 on
devnet (autonomous epochs, judge walkthrough, overnight run, leak audit). The behavioral experiment
remains deferred, as the spec states.

## 16. Development Roadmap

**Unchanged gates; Phase 0 extended** with the dependency audit and the SBF build proof above, and with
"no Avalanche fixtures" (**A9**). The Phase-1 gate is kept permanently as `tests/measurements/gate_pocd.rs`.

## 17. Calendar

**Unchanged.** Deadline Fri 18 Sep 2026 20:00 UTC; target submit 16:00 UTC.

## 18. Solo Execution Order

**Unchanged.** Attack tests are written before the code they attack; every gate runs from a clean clone.

## 19. Three-Minute Judge Demo Script

**Unchanged.**

## 20. Likely Judge Questions

**One addition.** *"Is the privacy claim actually tested?"* — Yes: the IDL surface is allow-listed
(no instruction takes a size, no event carries an amount), and a leak-audit test scans every account,
transaction and log of a full epoch plus two loans for the plaintext of every secret quantity, on
LiteSVM, on a real validator, and after the overnight devnet run.

## 21. Competitive Positioning

**Unchanged.**

## 22. MVP Scope

**Unchanged**, with `deposit_collateral` (A5) as the first plan-level extra to cut if Phase 3 slips.
The spec's cut order (receiver-read stretch → unwrap → positions page → lender UI → auditor-rotation
demo) and its never-cut list stand.

## 23. Post-Hackathon Extensions

**Unchanged.** Note that the `solana-zk-sdk 7/8` line (with `solana-zk-elgamal-proof-interface`) is
the natural upgrade path once Anchor moves to `solana-instruction 4`.

## 24. Project Submission Description

**Unchanged.**

## 25. Final Pitch

**Unchanged.**

---

### Amendment index

| Id | Section | One line |
|---|---|---|
| A1 | 7.2, 9 | Print batched: `begin_print` → `attest_ticks` (inline PoCDs) → `finalize_print` |
| A2 | 7.1, 11 | `Bid` PDA per (epoch, member, side, tick) replaces the per-member fill map |
| A3 | 7.3 | Solvency units: milli-shares, cents, milli-multiplier; `k_c = p′·a`, `k_l = 150` |
| A4 | 7.1 | Wrap = transfer + mint + owner-signed `Deposit`; no proof needed |
| A5 | 8, 9 | Borrower transfers to escrow; `deposit_collateral` verifies the transfer instruction |
| A6 | 7.3, 11 | `Loan.size_ct` 2-handle, copied from the bid for full fills |
| A7 | 5, 9 | Multiplier from the mint's `ScaledUiAmount` extension |
| A8 | 7.4, 11 | Zero-copy `Epoch`/`Print`; `auditor_pubkey` per epoch |
| A9 | 1, 6, 16 | Fresh build; nothing from the prior project; CI lineage check |
| A10 | 15, 16 | Toolchain errata (2026-09-16): proofs must be generated with `solana-zk-sdk` ≥ 5 (7.0.1 used) — zk-sdk 5.0 changed the sigma-proof transcript and the deployed verifier (Agave ≥ 4.2) rejects zk-sdk 4 proofs. Tier-1 tests run on LiteSVM 0.16 (Agave 4.2 runtime) with the deployed Token-2022 (zk-ops) loaded; Rust 1.98. Partial-fill loans carry an ECDH-sealed opening note so the borrower can prove solvency for them. Measured numbers in §15 are unchanged. |
| A11 | 5, 9, 14 | **Price source: Pyth's on-chain account, not the Hermes API (2026-09-16).** Pyth's public Hermes HTTP endpoint began returning `401 unauthorized` for price updates, and the feed id carried in the profiles (`0x16dad506…`) was not a Pyth feed at all. The keeper now reads Pyth's **on-chain `PriceUpdateV2` account** over RPC — no API key — checks that the account is owned by the Pyth receiver (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`) and that the `feed_id` inside it is the configured one, and copies `price`, `expo` and `publish_time` into `PriceCache`. The demo asset is Pyth **Crypto.TSLAX/USD**, `0x47a15647…a362`, published at mainnet account `GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY`; the desk runs on devnet, where Pyth publishes no equity feed, so that one account is read cross-cluster. Two consequences are recorded rather than hidden: the on-chain staleness rule bounds how recently *the keeper posted*, while the feed's own `publish_time` is stored unmodified so the age of the quote is public; and outside US market hours an equity feed stops advancing. When a profile has no Pyth account (localnet, CI) it must carry the documented all-zero feed id, and `Profile::validate` rejects any profile that pairs a real feed id with no account or a mock id with one — so a mock price can never be published under a real feed id. |
| A12 | 16, 22 | **Program size is a budget (2026-09-16).** `programdata` rent is paid once and permanently at the first deploy (devnet: 5,080.9 lamports/byte), so the five programs are compiled `opt-level = "z"` per package in the workspace root — `overflow-checks = true` is inherited and unchanged. Total on-chain size is 1,252,952 B (6.367 SOL) instead of 1,367,224 B (6.947 SOL). The cost is 11–26 % more compute units; transaction counts and sizes are identical (§15 measurements re-recorded), and the worst single transaction is still the 111,000-CU range-proof verification, far below the limit. `make size` enforces the budget in CI. |
| A13 | 5, 9, 14, 16 | **A fresh quote, and the quote's own age enforced on chain (2026-09-17).** The mainnet push account A11 named (`GpoWLTd6…`, shard 0) stopped being updated on 2026-09-12 12:18 UTC; until 2026-09-17 the keeper re-posted that quote with a fresh `posted_slot` and the slot-based rule could not tell. `Crypto.TSLAX/USD` is a 24/7 feed — the account died, not the feed (A11's "an equity feed stops overnight" was wrong). The keeper now reads Hermes with an API key when `PYTH_API_KEY` is set (`pyth.dourolabs.app/hermes`, bearer token, keeper-side only) and otherwise — or whenever Hermes fails — the freshest of Pyth's push-oracle accounts for shards 0 and 1 plus the profile's account, owner- and feed-id-checked as before. `window-admin price-check` prints the source and the quote's age without a transaction. On chain, `lock_collateral` and `seize` now enforce `now − price.publish_time ≤ max_publish_age_secs` beside the slot rule (`QuoteStale`), and `post_price` refuses a `publish_time` more than 60 s in the future (`PublishTimeAhead`). Tier 1 drives `Clock.unix_timestamp` (LiteSVM's `warp_to_slot` moves only the slot) and `attack_07` gains the freshly-posted-but-stale case. |
| A14 | 7, 9, 12, 14, 16, 22 | **One rate, a collateral schedule (2026-09-17; devnet upgrade of `window_credit` only).** `Config` is frozen, so eligible collaterals are added *additively* as `Listing` accounts `["listing", cstock_mint]` — mints, escrow, `feed_id`, `price_source` (0 Pyth · 1 Tessera mark · 2 PreStocks mark · 3 mock), `haircut_bps`, `max_price_age`, `max_publish_age_secs`, `symbol` — created by the admin-only `add_listing`, retuned (limits, haircut, label only) by `update_listing`. `post_price` posts under a listing's feed id (listing #0 reuses `Config.feed_id`, so the original `PriceCache` keeps its history); `lock_collateral` binds the loan to its listing (`Loan.listing`, a field appended after `bump` so every earlier offset is unchanged, 414 → 446 B); `deposit_collateral`, `seize` and `release_collateral` refuse any other listing (`WrongListing`). The 65 pre-listing loans on devnet were resized by the admin-only `migrate_loan` (rent topped up from the admin). Non-Pyth listings carry `sha256("<source>:<symbol>")` as their feed id — a label, never a Pyth id — and their `publish_time` is the keeper's fetch time: an attested mark, stated on chain (`price_source`), in the profile and in the UI. `window_wrap` needs no change (already per mock mint). `window_credit.so` grows to 372,072 B (+44.7 KB for three instructions and one account type), past the 343,088 B allocated at the first deploy, so the devnet upgrade extends `programdata` (~0.15 SOL, permanent); `SIZE_BUDGET` rises from 1,280,000 to 1,320,000 B. Devnet schedule: `TSLAx-mock` (Pyth, 150 %, 1 h), `T-OpenAI-mock` (Tessera, 200 %, 48 h), `ANTHROPIC-mock` (PreStocks, 200 %, 48 h) — devnet twins; no mainnet token is touched. Tier 1: `attack_09_wrong_listing`, `attack_10_listing_admin`, a second-listing lifecycle and a migration case; tier 2: `second_listing.test.ts`. Record: `docs/TRACKS.md`. |
