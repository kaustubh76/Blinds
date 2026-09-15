# THE WINDOW for Stocks — Full Stocklana Build Specification

**A private margin desk for tokenized stocks on Solana. Encrypted collateral and bids in Token-2022 Confidential Balances, homomorphically summed on-chain, cleared by an accountable administrator whose decryption is proven on-chain every print. Collateral solvency is proven against the public Pyth price — with the corporate-action multiplier inside the proof — without ever revealing the position. The output is xONIA, the xStocks Overnight Index Average: the first on-chain borrow rate for tokenized equities.**

> The rate is public. The price is public. The position never was.

| | |
|---|---|
| Event | **Stocklana** · $100K · Solana Foundation · deadline **Fri 18 Sep 2026 20:00 UTC** · target submit 16:00 UTC |
| Wedge | **Credit & Yield** — "borrowing against stocks" (the brief's own words); Infrastructure (rate + proofs) secondary |
| Lineage | Adaptation of THE WINDOW — 1st place, Team1 India Speedrun "Privacy on Avalanche" (July 2026); 7,190 epochs printed on Fuji. The mechanism is validated; the substrate (Solana-native proofs) and the collateral (tokenized stocks) are new. |
| Status | Specification. Mechanism frozen before code; only §7.3's priced-solvency amendment is new mathematics. |
| Builder | Solo · Anchor · devnet · ~3.5 days |
| Honest-claims rule | Never "trustless", "undecryptable", "nobody can see". The administrator **can** decrypt individual amounts. The public sees aggregates, the price, and the rate — each proven or publicly attributable. |

---

## 1. Executive Summary

**Core problem.** Observable borrowing kills lending markets — and observable *collateral* kills securities lending twice over. In TradFi, margin lending against stocks is a multi-hundred-billion-dollar business precisely because it is private: your broker sees your position and your loan; the world sees nothing. In 2007–08 banks paid a 44 basis-point premium, 126 bp after Lehman, to avoid being *seen* borrowing at the Federal Reserve's discount window; the New York Fed's 2024 staff report finds that stigma alive today. On a transparent blockchain the disclosure lag is zero and the tax is infinite: borrow USDC against your TSLAx in any transparent protocol and you broadcast — permanently, in real time, to every counterparty — your position size, your leverage, your liquidation level, and your urgency.

**The measured consequence on Solana.** ~$684M of tokenized-equity supply and 727,000+ holder addresses, yet only ~5% of that value is deployed in DeFi — "because collateral is the test." Incumbent lenders cope by throttling: 60–75% LTVs and $1–5M per-asset debt caps against a $684M asset class. The serious size stays off-chain because coming on-chain means being seen. On a public ledger, the private margin account is not worse than TradFi's; it is impossible.

**The control loop THE WINDOW for Stocks creates.** Every epoch, members submit borrow bids (BID) and lend offers (ASK) at public rate ticks with **encrypted sizes**. An on-chain program sums the ciphertexts per tick without decrypting anything. At close, an accountable Benchmark Administrator — holder of the mint's auditor key — decrypts the **per-tick aggregates only**, computes the uniform clearing rate r\*, and posts the depth curve with one native zero-knowledge proof per tick that each claimed sum is the true decryption of the on-chain accumulator. The oracle program verifies every proof through Solana's ZK ElGamal Proof program, recomputes r\* itself, and prints **xONIA**. A valid proof with a wrong rate is rejected. Matched loans lock **tokenized-stock collateral** behind a priced solvency proof: collateral value — shares × public Pyth price × corporate-action multiplier — is proven to cover 150% of the loan without revealing either amount. Loans settle as confidential transfers; defaults are seized permissionlessly at deadline. The loop closes when the next epoch opens and members bid against the rate just printed.

**Objective.** Success is (a) a borrow flow a judge can complete from a wallet in under two minutes with the position never appearing in plaintext, (b) a benchmark rate any third party can re-verify from chain state alone, (c) an administrator that structurally cannot shape the rate, and (d) a bounded, measured cost per print. The project is **not** maximizing TVL or yield, does not claim to hide who participates, and does not custody real value.

---

## 2. The Central Question

> **Can a private securities-financing market — encrypted stock collateral, encrypted bid sizes, a uniform-price auction cleared from homomorphic aggregates, and a priced solvency proof against a public oracle — run end-to-end on Solana's native confidential-token primitives, producing a borrow rate for tokenized equities that is fully reproducible from on-chain state, at a bounded cost per print, with the position never appearing in plaintext?**

Two sub-questions are answered by this build; one is deferred:

1. **Composition (answered by the gate):** do Token-2022 grouped ciphertexts, curve25519 syscalls, and the ZK ElGamal Proof program compose into proof-of-correct-decryption of a homomorphic sum, at measurable CU cost?
2. **Priced solvency (answered by Day 2):** can a public scalar (price × CA-multiplier) enter the homomorphic solvency check so that volatile, rebasing collateral is safely valued without decryption?
3. **Behavioral (deferred):** does removing size observability reduce strategic bid shading versus a transparent auction? The base spec's B1/B2/T experiment is Colosseum-scope; this submission ships the attack tests and cost measurements, and defers the behavioral arms — stated openly in §15.

---

## 3. Why the Names

**THE WINDOW.** The Federal Reserve's discount window is the facility banks borrow from when short overnight — and the best-documented example of a lending facility crippled by the fear of being seen using it. THE WINDOW is that facility rebuilt so the borrowing is private and only the rate is public. *For Stocks* narrows it to the securities-financing version: the private margin desk.

**xONIA — the xStocks Overnight Index Average** — follows SONIA and EONIA (the sterling and euro overnight index averages) and this project's own M-ONIA on Avalanche. It is the overnight rate for borrowing dollars against tokenized equities, discovered by auction from encrypted bids.

What the names are not claiming: this is an economic analogy, not a Federal Reserve product, not a bank, not a broker-dealer, and not a regulated benchmark. xONIA is a devnet reference rate produced by a hackathon-scale market with disclosed simulated participants. The SOFR/SONIA comparison is one of governance *shape* — confidential inputs, accountable administrator, public aggregate — not of scale or legal standing. "xStocks" names the asset family the mechanism targets; the demo uses mock mints mirroring their Token-2022 layout (§14).

---

## 4. Why This Fits Stocklana

The brief: *"Tokenized stocks already trade on Solana. Build what makes owning and using them better than today's brokerage app. Pick one wedge and make it excellent."* Judging is one question: **could this be a real app that people will actually use?** — decomposed by the organizers into a real user and problem, a working end-to-end demo, a reason it belongs on Solana, and quality of execution.

| Judging component | How THE WINDOW for Stocks answers it |
|---|---|
| **Wedge discipline** | One wedge — Credit & Yield, "borrowing against stocks," verbatim from the brief — made excellent. The rate and proofs serve that wedge rather than dilute it. |
| **Real user & problem (T1)** | The tokenized-stock holder with meaningful size: 727K+ addresses, $684M supply, ~95% undeployed because on-chain borrowing exposes the position. TradFi proves the demand shape: securities-based lending is enormous *because* it is private. |
| **Better than the brokerage app** | Same privacy as a brokerage margin account, **plus** what no brokerage shows you: a market-discovered, administrator-proof public borrow rate, and cryptographic proof that every published number is true. |
| **End-to-end demo (T2)** | Live devnet market printing xONIA autonomously every ~2 minutes; a judge connects a wallet, wraps mock-TSLAx, bids, gets matched, locks collateral behind the priced proof, draws USDC — every beat a signed transaction; the explorer re-verifies every sigma proof in the browser. |
| **Why Solana (T3)** | Every layer is a Solana-native primitive used as designed: Token-2022 Confidential Transfers as market inputs, the mint auditor key as the administrator role, curve25519 syscalls for accumulation, the ZK ElGamal Proof program as trust anchor, Pyth's 24/7 xStocks feeds as the public valuation scalar — and the collateral itself, xStocks, lives on Solana as Token-2022. No circuits, no trusted setup, no bridge. This composition exists on no other chain. |
| **Execution quality (T4)** | On-chain attack tests (false sum, false rate, replay, missing proof, oversized bid, undercollateralized borrow — all rejected); the corporate-action rebasing multiplier — the landmine that breaks naive xStocks integrators — handled *inside the solvency proof*; limitations stated verbatim in the README. |

**Field position:** among the 42 visible entries at spec time, the Credit & Yield wedge is untouched and privacy is untouched. This entry is alone in its lane, with the heaviest native-primitive usage in the field.

---

## 5. Connection to Official / Existing Ideas

| Prior concept | What it provides | This build's extension |
|---|---|---|
| **Token-2022 Confidential Transfers / Confidential Balances** | twisted ElGamal ciphertexts over Ristretto; pending/available encrypted balances; an auditor key per mint; native deposit/withdraw/transfer proofs | uses the ciphertexts as *auction inputs and collateral*, and the auditor key as a *benchmark-administrator role*; sums ciphertexts across accounts inside a program |
| **ZK ElGamal Proof program** (`ZkE1Gama1Proof11111111111111111111111111111`) | verifies sigma proofs: zero-ciphertext, ciphertext–commitment equality, grouped-ciphertext validity, batched range proofs; records results in context-state accounts | composes `ZeroCiphertext` into proof-of-correct-decryption of an aggregate, and `CiphertextCommitmentEquality` + `BatchedRangeProof` into a **priced** solvency proof — no custom circuits |
| **curve25519 syscalls** (`sol_curve_group_op`, `sol_curve_multiscalar_mul`) | cheap Ristretto point addition and scalar multiplication on-chain | homomorphic accumulation of bids per tick; **scalar-weighted valuation** (price × multiplier) in the solvency check |
| **Pyth xStocks feeds** (`TSLAXUSD`-class, 24/7 schedule) | public, always-on reference prices for the tokenized-stock mints themselves | the **public scalar** inside the confidential solvency proof — "the price is public, the position is not" |
| **xStocks on Token-2022** (832 assets, 24/5 trading, rebasing CA multiplier in metadata) | the collateral asset family and its known integration landmine | the multiplier is folded *into the solvency scalar*, so a split can neither fake nor destroy coverage |
| **SOFR / SONIA administration** | confidential transaction inputs, accountable administrator, public aggregate, IOSCO-style oversight | the same shape with the administrator's honesty *proven per print* rather than institutionally trusted |
| **Uniform-price sealed-bid auctions** (treasury auctions, Gnosis Auction) | one clearing price, pro-rata at the margin | bids stay encrypted *after* clearing; clearing is recomputed on-chain from a proven curve |
| **THE WINDOW on Avalanche** (this project's prior build) | eERC + chunked Groth16 PoCD; 7,190 epochs on Fuji | native sigma proofs replace custom circuits; range-proven bids; **stock collateral with priced solvency** |

---

## 6. What Makes This Different

**vs. transparent stock-collateral lending (Kamino-class).** The incumbent proves the problem: throttled LTVs and single-digit-million debt caps against a $684M asset class, because transparent collateral invites being traded against and the lender prices that in. Here the position is encrypted end-to-end, and the *rate* is discovered by auction instead of set by a utilization curve.

**vs. a confidential token alone (Token-2022 CT, Arcium-wrapped assets).** A confidential token hides balances. It has no auction, no clearing rule, no benchmark, and no way to *value* hidden collateral. This build is the first thing that does something with the ciphertexts: it clears a credit market, values encrypted stock against a public price, and proves everything it publishes.

**vs. transparent rate oracles (IPOR-class).** Those republish public inputs; anyone could compute them, so the category earned nothing and shrank toward zero. xONIA aggregates information *not observable any other way* — encrypted bid depth — which is the only condition under which a benchmark administrator has a durable role.

**vs. THE WINDOW on Avalanche.** Same mechanism, better substrate, harder collateral. Avalanche needed two custom circom circuits, a trusted setup, and a 10-tick chunking trick under EIP-170; collateral was same-asset, so solvency needed no price. Solana gives native sigma proofs, range-proven bids at submission, and syscall accumulation — and this build adds the priced, rebase-safe solvency proof that stock collateral demands.

| | Transparent stock lending | Rate oracle (IPOR-class) | Confidential token alone | WINDOW on Avalanche | **WINDOW for Stocks (this build)** |
|---|---|---|---|---|---|
| Position hidden | no | n/a | yes | yes | **yes** |
| Market cleared from hidden inputs | no | no | no | yes | **yes** |
| Published curve proven on-chain | n/a | no | n/a | yes (Groth16 ×4) | **yes (native sigma)** |
| Volatile, rebasing collateral valued without decryption | no (public) | n/a | no | n/a (same-asset) | **yes (priced solvency)** |
| Bid well-formedness enforced at submit | n/a | n/a | yes | no | **yes (range proof)** |
| Custom circuits / trusted setup | no | no | no | 2 circuits, Hermez ptau | **none** |
| Benchmark output | utilization APY | mirror of public data | none | M-ONIA | **xONIA** |

---

## 7. Core Mechanism

### 7.1 Observation / Input Capture

Every relevant event is account state plus an Anchor `emit!` log so the indexer never replays heavy computation.

**Membership.** `MemberRegistry` holds a PDA per member: `(pubkey, elgamal_pubkey, joined_epoch, active)`. Admission is admin-gated for the hackathon. Members hold Token-2022 accounts with the Confidential Transfer extension on **two mints**: `cUSDC-W` (confidential wrapped USDC — the loan leg) and `cSTOCK-W` (confidential wrapped mock-xStock — the collateral leg). One-click onboarding configures both.

**Wrap (new).** `window_wrap::wrap(amount)` pulls mock-xStock via `transfer_checked` (Token-2022, extensions respected) into program custody and mints `cSTOCK-W` 1:1 into the member's confidential pending balance; the member applies it to available balance with the standard native proof. `unwrap` reverses on release. Invariant: `cSTOCK-W` supply equals wrapped mock-xStock custody, asserted in tests.

**Bid.** During an `Open` epoch a member submits `(side, tick, ciphertext)`:

- `side ∈ {ASK, BID}` and `tick ∈ [0, 36]` are **public**. Tick t maps to 100 + 25t bp: the band is 1.00%–10.00% at 25 bp. BID = borrow USDC (stock collateral); ASK = lend USDC.
- `ciphertext` is a **grouped twisted ElGamal ciphertext with two decryption handles** (member, auditor) sharing a Pedersen commitment to the size in micro-USDC.
- The submission references two verified proof contexts: `GroupedCiphertext2HandlesValidity` (well-formed under both keys) and `BatchedRangeProof` that the size lies in [s_min, 2^40), proven on (s − s_min).

The program checks the contexts, accumulates commitment and auditor handle into the epoch's per-tick accumulator via the Ristretto addition syscall, marks `(member, side, tick)` filled (one bid per member per side per tick per epoch), closes the contexts, and emits `BidSubmitted { epoch, member, side, tick }`. **No size is ever logged.**

**Price cache (new).** The keeper posts `(feed_id, price, expo, publish_time)` from the named public Pyth 24/7 xStocks feed into a `PriceCache` PDA at least once per epoch. Solvency and seize instructions require `now − publish_time ≤ max_price_age`. Provenance is attested (§14); an on-chain receiver read is a stretch goal with an identical downstream path.

**Epoch clock.** `open_epoch` / `close_epoch` are keeper-gated but slot-gated: close requires `slot ≥ start_slot + epoch_slots`; after `keeper_grace_slots` any signer may close, so a dead keeper cannot freeze the market.

### 7.2 Delayed / External Signal

The outcome signal is the decrypted depth curve, producible only by the administrator (holder of the auditor ElGamal secret). Off-chain, on `EpochClosed`:

1. Read the 74 accumulators (2 sides × 37 ticks) from the epoch account.
2. For each nonzero accumulator, decrypt with the auditor secret to obtain v·G; recover v by baby-step giant-step over the bounded range.
3. Build cumulative supply/demand curves; compute r\* (§7.3).
4. Generate one `ZeroCiphertext` proof per nonzero accumulator; submit each to the ZK ElGamal Proof program into a context-state account owned by the oracle's proof authority.
5. Call `finalize_print(epoch, claimed_sums[74], r_star_tick)`.

**Validation rules the program applies:**

- *Coverage.* Every nonzero accumulator needs a verified proof context whose ciphertext equals (C_t − v_t·G, D_t) for this epoch and tick. Zero accumulators: program checks identity point and requires v_t = 0.
- *Bound.* Every claimed v_t ≤ n_t·2^40 (n_t = on-chain bid count; every bid was range-proven).
- *Recompute.* The program recomputes r\* from claimed sums; mismatch rejects the call.
- *Uniqueness.* One print per epoch; contexts consumed and closed at finalize.
- *Freshness.* No print within `stale_after_slots` of close → last print marked `stale = true`; the next epoch opens regardless (§7.6).

### 7.3 Core Calculation

**Twisted ElGamal (as used by Token-2022).** Fixed independent Ristretto generators G, H. Keypair (s, P), P = s⁻¹H. Encrypting m with randomness r:

  C = mG + rH,  D_P = rP.

A grouped ciphertext shares C with one handle per recipient: (C, D_member, D_auditor).

**Homomorphic accumulation.** For side σ, tick t, after n bids:

  C^σ_t = Σ C_i = (Σ m_i)G + (Σ r_i)H,  D^σ_t = Σ D_auditor,i = (Σ r_i)P_aud.

Single Ristretto additions per bid via syscall.

**Decryption (administrator only).** With auditor secret s:

  C^σ_t − s·D^σ_t = (Σ m_i)G = v^σ_t·G,

v recovered by BSGS over [0, n_t·2^40].

**Proof of correct decryption (PoCD).** Publishing v^σ_t is a claim; the proof is that the residual ciphertext encrypts zero under the auditor key:

  (C^σ_t − v^σ_t·G, D^σ_t) ∈ Enc_{P_aud}(0)

— exactly the ZK ElGamal Proof program's `ZeroCiphertext` sigma proof. The verifier reconstructs the residual itself from the on-chain accumulator and the claimed v; the administrator supplies nothing but v and the proof.

**Uniform-price clearing.**

  S(r) = Σ_{t≤r} v^ASK_t,  D(r) = Σ_{t≥r} v^BID_t,  r\* = min{ r : S(r) ≥ D(r) > 0 }.

All fills clear at r\*; matched volume = min(S(r\*), D(r\*)); pro-rata at the marginal tick computed by the administrator and disclosed. No such r → **no trade**; last print carried with `stale = true`.

**Priced collateral solvency (the amendment — the only new mathematics).**
Collateral ciphertext E_c encrypts the **share count** c in base units (range-proven < 2^40). Loan ciphertext E_ℓ encrypts micro-USDC ℓ. Public inputs: Pyth price p (micro-USDC per share base unit, staleness-checked from `PriceCache`) and the corporate-action rebasing multiplier as the public rational a/b (from mint metadata). Haircut 150%. The program forms, by scalar-mult and subtraction syscalls:

  **E_Δ = (100·p·a)·E_c − (150·b)·E_ℓ**

The borrower supplies a fresh Pedersen commitment K to Δ = 100pac − 150bℓ, a `CiphertextCommitmentEquality` proof that E_Δ and K hold the same value, and a `BatchedRangeProofU64` that K ∈ [0, 2^64). Together: **p·(a/b)·c ≥ 1.5ℓ — collateral value covers 150% of the loan — with neither the position nor the loan revealed.**

Soundness conditions:
- *Scalar-overflow bound:* the program requires 100·p·a·2^40 < 2^63 at configuration; price and multiplier scaling at the wrapper guarantees it for demo assets; asserted in tests.
- *Rebase safety:* a/b multiplies the **scalar**, not the ciphertext — a 10:1 split changes the public factor and leaves the encrypted shares untouched, so a rebase can neither fake nor destroy solvency.
- *Freshness:* solvency and seize both require `PriceCache` within `max_price_age`; a stale price can neither admit a loan nor seize one.

**Sign conventions and adverse outcomes.** Borrowers benefit from lower r\*; lenders from higher. Enforced adverse-outcome definitions: administrator deviation Δ_adm = |r\*_claimed − r\*_recomputed| (must be 0 on-chain); proof coverage ρ = proven nonzero accumulators ÷ nonzero accumulators (must be 1 at finalize); staleness τ = epochs since last trade print; price age = now − publish_time (bounded at use).

### 7.4 Aggregation / Epoch Logic

| Quantity | Aggregated over | Purpose |
|---|---|---|
| Per-tick accumulators (C, D) and counts n^σ_t | one epoch | inputs to the print |
| Proof-verified bitmap (74 bits) | one epoch | coverage ρ |
| Claimed sums v^σ_t | one epoch | depth curve and r\* recompute |
| Print history (r\*, matched, stale) | all epochs | the xONIA time series |
| Staleness counter τ | rolling | regime and hysteresis |
| PriceCache (p, publish_time) | rolling | valuation freshness |

Primary control metric: **ρ = 1** or no print. Secondary: **τ** drives the regime. Tertiary (new): **price age** gates credit actions. Epoch length in slots: 300 (~2 min) demo; 9,000 (~1 h) production profile.

### 7.5 Controller / Decision Rule

```
if all nonzero accumulators proven and every v_t within bound:
    r_star = recompute(v)                    # must equal claimed, else reject
    if r_star is None:  regime = NoTrade; carry last print; stale = true; tau += 1
    else:               regime = Printed; print (r_star, matched); stale = false; tau = 0
    if r_star in {0, 36} for BAND_EDGE_EPOCHS consecutive prints: flag BandEdge
else:
    reject finalize (no state change)

lock_collateral: require verified equality+range contexts AND price_age ≤ max_price_age
seize:           require slot > deadline_slot AND status == Active AND price_age ≤ max_price_age
```

**Parameters (demo / production profile)**

| Parameter | Demo | Production | Notes |
|---|---|---|---|
| `epoch_slots` | 300 (~2 min) | 9,000 (~1 h) | slot-gated close |
| `tenor_slots` | 150 | 54,000 (~6 h) | overnight-style loan life, inside the 24/5 trading week |
| Tick grid | 37 ticks, 1.00–10.00%, 25 bp | same | 74 accumulators |
| Bid size range | [1 USDC, 2^40 µUSDC) | same | ~1.1M USDC max per bid |
| Haircut | **150%** | 150% (illustrative) | equity gap risk; not risk-calibrated (§14) |
| `max_price_age` | 75 slots (~30 s) | 300 slots | Pyth 24/7 feed keeps this satisfiable |
| `stale_after_slots` | 450 | 13,500 | print deadline after close |
| `keeper_grace_slots` | 150 | 4,500 | anyone may close after |
| `BAND_EDGE_EPOCHS` | 5 | 24 | flag only |
| Max txs per print | 16 | 16 | measured (§15) |
| BSGS range | 2^44 | 2^48 | ≤ n_t·2^40 |
| Scalar bound | 100·p·a·2^40 < 2^63 | same | asserted at config |

### 7.6 Controlled Decay / Hysteresis

- **Stale carry.** No-trade or missed print carries the last r\* with `stale = true`; clears only after **two consecutive** trade prints — one thin epoch cannot flap the benchmark.
- **Missed-print recovery.** Administrator misses `stale_after_slots` → epoch stays `Closed`, the next opens anyway, late finalize allowed (proofs bind to that epoch's frozen accumulators). Consumers read `stale` and τ.
- **Price staleness.** A dead price keeper halts *credit actions only* (no lock, no seize); the auction and prints continue. Loans in flight cannot be seized on stale prices — safety degrades to inaction, never to wrong action.
- **Band-edge.** `BandEdge` sets after `BAND_EDGE_EPOCHS` consecutive edge prints, clears after the same count interior. Flag only; no auto-recentering.
- **Keeper handoff.** After grace, any signer closes; closing is idempotent per epoch, so no keeper oscillation.

---

## 8. Why the Off-Chain Administrator and the ZK ElGamal Proof Program Are Essential

A pure on-chain program cannot run this market, for structural reasons:

1. **Decryption requires a secret.** Accumulators are ciphertexts under the auditor key; no program can hold that key. Someone off-chain must decrypt, solve the bounded discrete log, and compute the curve.
2. **Proof generation requires the same secret.** `ZeroCiphertext` is a proof of knowledge of s; it must be generated where s lives.
3. **Solana has no scheduler.** Epochs open and close by keeper transactions on a slot schedule; prices are pushed, not pulled.

The ZK ElGamal Proof program is what makes the off-chain administrator *accountable*: it verifies the sigma proofs into context-state accounts the oracle reads. Without it the curve is an attestation; with it, the curve is proven.

**Essential jobs (solo deployment: administrator = keeper = operator = price poster, one disclosed key; roles remain separate in program design)**

| Role (program-level) | Jobs |
|---|---|
| Administrator | decrypt accumulators; BSGS; compute r\* and matches; generate ≤74 sigma proofs; submit proof txs; `finalize_print`, `post_matches`; attest funding/repayment; never write plaintext sizes to logs or APIs |
| Keeper | `open_epoch`/`close_epoch` on schedule; post `PriceCache` from the named Pyth feed each epoch; `seize` past deadline; low-balance alerts |
| Operator | custody wrapped collateral escrow in a confidential account; `confirm_lock`; release/seize transfers on program events |
| ZK ElGamal Proof program | verify every proof; write context-state accounts |
| Indexer | subscribe to logs; rebuild depth, prints, loans; serve `/xonia`, `/depth`, `/loans`, `/verify/:epoch` |

**Causal chain for one epoch**

```
keeper ──open_epoch──▶ Auction(Open);  keeper ──post_price──▶ PriceCache
member ──wrap(mock-xStock)──▶ cSTOCK-W confidential balance
members ──[validity+range proofs → ZK program → contexts]──▶ submit_bid ──▶ accumulate, close contexts
keeper ──close_epoch (slot-gated)──▶ Auction(Closed), accumulators frozen
admin ──decrypt, BSGS, r*──▶ [≤74 × VerifyZeroCiphertext → contexts]
admin ──finalize_print(sums, r*)──▶ Oracle: identity ticks, bounds, recompute, consume, print xONIA
admin ──post_matches @ r*──▶ Credit: loans Pending
borrower ──[equality+range proofs → contexts]──▶ lock_collateral (price-fresh) ──▶ Requested
operator ──confidential transfer to escrow──▶ confirm_lock ──▶ Locked
lender ──confidential principal──▶ admin ──confirm_funding (attested)──▶ Active
borrower ──confidential repayment──▶ admin ──repay──▶ Repaid → release (→ unwrap optional)
   or keeper ──seize (slot>deadline, price-fresh)──▶ Defaulted → seize_to(lender)
indexer ──logs──▶ dashboard, rate feed, /verify
```

---

## 9. Smart Contract Architecture

All Anchor programs. Solana has no view functions; the "lens" is an SDK module plus indexer endpoints that deserialize accounts and re-verify proofs.

| Program | Responsibilities | Permissions and constraints |
|---|---|---|
| `window_registry` | member PDAs; `add_member`/`remove_member`; stores each member's ElGamal pubkey | admin signer only; emits MemberAdded/Removed |
| `window_wrap` **(new)** | 1:1 wrap/unwrap between mock-xStock (Token-2022, real-extension mirror) and `cSTOCK-W`; custody PDA; supply invariant | wrap/unwrap open to registered members; `transfer_checked` only |
| `window_auction` | Config PDA (admin, keeper, oracle, mints, params incl. scalar bound & max_price_age); Epoch PDA with 74 accumulators, counts, filled bitmap, status; `open_epoch`, `close_epoch`, `submit_bid` | open/close keeper-gated then permissionless after grace; `submit_bid` requires registry PDA, Open status, two verified contexts, closes them; `mark_printed` only via CPI from `window_oracle` |
| `window_oracle` | Print PDA per epoch (claimed sums, r\*, matched, stale, τ); `finalize_print`; `latest_rate` | admin-gated; requires Closed; reads 0–74 contexts; identity check for zero ticks; bounds; recompute; consumes contexts; CPI `mark_printed` |
| `window_credit` | Loan PDAs (lender, borrower, epoch, tick, size ciphertext, deadline, status); `post_matches`, `lock_collateral` (priced solvency), `confirm_lock`, `confirm_funding`, `repay`, `seize` | `post_matches`/`confirm_funding`/`repay` admin-gated; `confirm_lock` operator-gated; `seize` permissionless when slot > deadline ∧ Active ∧ price fresh; terminal states final |
| `PriceCache` PDA | `{feed_id, price, expo, publish_time, posted_slot}` | keeper-posted; readers enforce staleness |

**Mathematical crates (pure, independently testable)**
- `window-elgamal` (no Solana deps): twisted ElGamal, grouped ciphertexts, homomorphic ops, BSGS; serialization identical to `solana-zk-sdk`; property-tested against it.
- `window-clearing`: cumulative curves, r\*, matched, pro-rata; ported from the Avalanche `computeClearing` with identical fixtures — both builds must print identical rates on identical curves.
- `window-proofs` (over `solana-zk-sdk`): builders for bid proofs, PoCD proofs, and the priced-solvency pair; verifier mode re-checks any print or loan from raw account data.

**Read-only lens.** `@thewindow/solana-sdk` (TS): `fetchEpoch`, `fetchDepth`, `fetchPrint`, `fetchLoans`, `verifyPrint(epoch)` — downloads accumulators, claimed sums, proof txs and re-verifies every sigma proof client-side — and `verifySolvency(loan)` for the priced check. Explorer shows raw ciphertexts beside the proven curve with a green "re-verified locally" badge.

External programs: Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), ZK ElGamal Proof (`ZkE1Gama1Proof11111111111111111111111111111`), Instructions sysvar if same-tx proof introspection is used instead of context accounts.

---

## 10. Repository Structure

```
the-window-stocks/
├── Anchor.toml
├── Cargo.toml                      # workspace
├── programs/
│   ├── window_registry/
│   ├── window_wrap/                # NEW: 1:1 confidential wrapper for mock-xStock
│   ├── window_auction/
│   ├── window_oracle/
│   └── window_credit/              # priced solvency lives here
├── crates/
│   ├── window-elgamal/
│   ├── window-clearing/            # Avalanche fixtures included
│   └── window-proofs/              # + priced-solvency builders/verifier
├── services/
│   └── admin/                      # Rust: administrator+keeper+operator+price poster (one key, disclosed)
│   ├── agents/                     # TS: scripted members (labelled simulated)
│   └── indexer/                    # TS: logs → state → REST (/xonia, /depth, /loans, /verify/:epoch)
├── sdk/                            # @thewindow/solana-sdk (lens + verifySolvency)
├── app/                            # dashboard (Vite+React, wallet-adapter): home, explorer, borrow desk, positions
├── tests/                          # anchor + property tests; ZK program integration on localnet; attack tests
├── scripts/                        # mock-xStock mint (real-extension mirror), confidential mints, fund, deploy, snapshot
├── config/                         # DEMO / PROD parameter profiles
├── deployments/                    # localnet/devnet program IDs, mints, feed ids
└── docs/
    ├── SPEC.md                     # this document
    ├── METHODOLOGY.md              # xONIA methodology + leak budget
    ├── THREAT_MODEL.md
    └── DEMO.md
```

(vs. base spec: `experiments/` removed — deferred to Colosseum; `window_wrap` added; services collapsed to one admin binary.)

---

## 11. Risk / Control State

```rust
#[account]
pub struct Epoch {
    pub index: u64,
    pub status: EpochStatus,                    // Open | Closed | Printed | NoTrade
    pub start_slot: u64,
    pub close_slot: u64,                        // 0 until closed
    pub acc_commitment: [[[u8; 32]; 37]; 2],    // Ristretto points, side × tick
    pub acc_handle:     [[[u8; 32]; 37]; 2],    // auditor decryption handles
    pub bid_count:      [[u32; 37]; 2],
    pub fills: Pubkey,                          // companion PDA: per-member 74-bit fill map, closed at print
}

#[account]
pub struct Print {
    pub epoch: u64,
    pub claimed_sum: [[u64; 37]; 2],            // micro-USDC
    pub proven_bitmap: [u8; 10],                // 74 bits; must equal nonzero bitmap at finalize
    pub r_star_tick: Option<u8>,                // None = no trade
    pub matched_volume: u64,
    pub stale: bool,
    pub tau: u16,
    pub regime_flags: u8,                       // BAND_EDGE …
    pub finalized_slot: u64,
}

#[account]
pub struct Loan {
    pub lender: Pubkey, pub borrower: Pubkey,
    pub epoch: u64, pub tick: u8,
    pub size_ct: GroupedCiphertext,             // never plaintext
    pub deadline_slot: u64,
    pub status: LoanStatus,                     // Pending|Requested|Locked|Active|Repaid|Defaulted
    pub price_at_lock: u64, pub mult_at_lock: (u64,u64),  // public record of the scalar used
}

#[account]
pub struct PriceCache {
    pub feed_id: [u8; 32], pub price: u64, pub expo: i32,
    pub publish_time: i64, pub posted_slot: u64,
}
```

Regimes: `Open`, `Closed`, `Printed`, `NoTrade`; orthogonal flags `stale`, `BandEdge`; credit gate `price_fresh`. The rate is a pure function of the validated `claimed_sum` array; credit actions are pure functions of verified contexts plus a fresh public price. Nothing administrator-supplied is read except through the proof-checked path.

---

## 12. Required Security Properties

**Authentication and authorization**
- Config PDA holds admin, keeper, operator, oracle_program, both mints, feed_id, and parameters; every gated instruction checks the signer.
- Members authenticate by registry PDA; a bid's grouped ciphertext must carry the member handle under the ElGamal pubkey in that PDA (checked via the validity context's pubkeys).
- `mark_printed` callable only by CPI from `window_oracle` (caller program ID verified).
- `PriceCache` writable only by the keeper key; readers enforce `max_price_age` and matching `feed_id`.

**Safety bounds**
- Claimed sums ≤ n_t·2^40; bids range-proven; one bid per member/side/tick/epoch; `MAX_BIDS_PER_EPOCH`.
- **Scalar bound** 100·p·a·2^40 < 2^63 asserted at config and re-checked at lock.
- **Wrap invariant:** cSTOCK-W supply == custody balance of mock-xStock, invariant-tested.
- Compute budget per instruction measured and asserted; `finalize_print` accepts proof sets only via verified context accounts, never unverified data.
- ZK program disabled by feature gate → finalize cannot succeed → market degrades to stale, credit to inaction.

**Observation and finalization safety**
- *Uniqueness:* one Print PDA per epoch; contexts consumed and closed at finalize and at lock.
- *Ordering:* finalize requires Closed; `post_matches` requires Printed; `confirm_funding` requires Locked; terminal loan states final.
- *Maturity:* `seize` requires slot > deadline ∧ price fresh; `close_epoch` requires the slot gate.
- *Binding:* each PoCD context's ciphertext is recomputed by the program from the specific epoch's frozen accumulator and claimed sum — a proof for another epoch/tick/sum cannot match; each solvency context binds to this loan's E_Δ under the current PriceCache.

**Liveness**
- Keeper dead → anyone closes after grace; prices stop → credit halts safely, auction continues.
- Administrator dead → prints stop, stale set, epochs cycle, late finalize allowed; auditor key rotatable via the mint's confidential-transfer config (between epochs only).
- Operator dead → locks stay Requested; no funds at risk beyond the borrower's own balances.

**Upgrade and governance (hackathon)**
- Upgrade authority held by the single builder key during the build; **set to `None` (immutable) at the submission tag.** Versioned program IDs; nothing merges after freeze. Parameters immutable per deployment except auditor-key rotation (exercised once, between epochs, in the demo if time allows).

---

## 13. Threat Model

| Threat | Required mitigation |
|---|---|
| Administrator publishes a false per-tick sum to reshape the curve | `ZeroCiphertext` PoCD per nonzero tick, verified by the ZK program, bound to the on-chain accumulator; identity check for zero ticks |
| Administrator publishes correct sums but a wrong r\* | on-chain recompute; mismatch rejects the print |
| Administrator withholds prints | stale flag + τ; epochs continue; late finalize; auditor key rotatable |
| Administrator leaks individual positions off-chain | disclosed trusted surface (§14); service never logs plaintext; threshold administrator is post-hackathon |
| **Keeper posts a manipulated or stale price to admit thin loans or force seizures** | PriceCache carries feed_id + publish_time from a named public 24/7 Pyth feed — any observer can compare; staleness bound at every credit action; `price_at_lock` recorded publicly per loan; on-chain receiver read is the roadmap closure |
| **Rebase (stock split) used to fake or destroy solvency** | multiplier a/b sits in the public scalar, not the ciphertext — valuation tracks the rebase by construction; regression test: 10:1 split leaves solvency verdicts unchanged |
| **Wrap inflation (mint cSTOCK-W without collateral)** | wrap is the only mint path; supply-vs-custody invariant tested; custody PDA holds via `transfer_checked` |
| Member submits malformed/oversized ciphertext to break BSGS or poison an aggregate | validity + range proofs at submit; bound check at finalize |
| Member dust-spams ticks | minimum size via range proof on (s − s_min); one bid per member/side/tick/epoch |
| Proof replay across epochs/ticks/loans | program recomputes expected ciphertexts from frozen state; contexts consumed and closed |
| Keeper griefing (early/never close) | slot-gated close; permissionless after grace |
| Front-running bids | ticks public, sizes hidden; uniform-price clearing removes intra-epoch ordering advantage; no plaintext to sandwich |
| Operator absconds with escrow | disclosed trusted surface; authority on-chain, custody in operator confidential account; two-step lock; release/seize are on-chain events |
| Lender under-funds a loan | administrator-attested funding in MVP (§14); equality-proof enforcement is a §23 extension |
| Auditor key compromise | rotation via Token-2022 UpdateMint config, **between epochs only** (program stamps the key epoch) |
| ZK ElGamal Proof program disabled (it was paused and re-enabled in 2025) | prints halt safely; credit halts; documented platform dependency |
| Tx-size/CU limits break a print | ≤16-tx print by design; identity shortcut trims proof count; measured (§15) |
| Sybil members | admin-gated admission; disclosed |

---

## 14. Honest Limitations

The project must not claim any of the following.

- **"Trustless" / "undecryptable."** The Benchmark Administrator holds the auditor key and can decrypt every individual bid, loan, and balance. The claim is *accountable* privacy: the public sees aggregates, the price, and the rate, and every published aggregate is proven.
- **Participation privacy.** Member keys, ticks, and timing are public. Hiding *who* participates is a §23 extension, not a delivered property.
- **Mock collateral.** Devnet cSTOCK-W wraps a mock xStock mint that mirrors the real assets' Token-2022 extension layout (including the rebasing-multiplier metadata). No real xStocks are touched; mainnet wrapping of real xStocks is roadmap.
- **Keeper-attested price.** The Pyth price enters via a keeper-posted cache attested against a named public 24/7 feed (feed_id and publish_time on-chain for anyone to check). An on-chain receiver read is roadmap unless the stretch lands. The multiplier is read from mock-mint metadata the team controls on devnet.
- **No intra-tenor margin calls.** Overnight tenor + 150% haircut + deadline seize only. The haircut is illustrative, not risk-calibrated.
- **Funding magnitude attested.** `confirm_funding` and `repay` are administrator attestations after decrypting the transfer's auditor ciphertext; the program enforces lifecycle finality, not transfer size (§23 closes this).
- **Custody with the operator.** A PDA cannot generate confidential-transfer proofs, so escrow sits in the operator's confidential account. Authority on-chain; custody not.
- **One key.** Administrator, keeper, operator, and price poster are one disclosed key in this deployment; the separation exists in program design, not operations.
- **Simulated members.** Auction depth comes from scripted bots operated by the team, labelled "simulated" everywhere; the judge-usable borrow flow is real but not organic demand.
- **Not a regulated benchmark; not a broker.** xONIA is a devnet reference rate; the SOFR/SONIA comparison is governance shape only. Nothing here is investment advice or a brokerage service.
- **Platform dependency.** The mechanism depends on the ZK ElGamal Proof program and curve25519 syscalls; if disabled, prints and credit stop.
- **Research deferred.** The base spec's B1/B2 behavioral experiment is not run for this submission (§15).
- **Unaudited. Single tenor. Do not custody real value.**

---

## 15. Verification & Measurement Plan (hackathon scope)

The base spec's three-arm behavioral experiment (transparent B1 vs attested B2 vs proven T, scenarios S1–S6, 200+ epochs) is **deferred to the Colosseum phase and said so**. What ships now is the verification core:

**Attack tests (ported S4/S5, as Anchor tests — all must be rejected on-chain):**
1. Administrator submits a false per-tick sum → finalize rejected.
2. Administrator submits correct sums, wrong r\* → rejected.
3. Proof replayed from a previous epoch/tick → rejected.
4. Finalize with one nonzero tick's proof missing → rejected.
5. Oversized / malformed bid ciphertext → submit rejected.
6. **Undercollateralized borrow** (value < 150%) → lock rejected.
7. **Stale price** at lock and at seize → both rejected.
8. **10:1 rebase replay** → solvency verdicts unchanged; naive-valuation reference shows −90% for contrast.

**Invariant tests (ported from the Avalanche suite):** collateral conservation, wrap supply == custody, deadline safety, no double terminal states, match ≤ min(S,D), epoch monotonicity, `ltv-scalar` bound holds for all configured assets.

**Measurements (reported in README, regressions included):**
- Print cost: transactions, bytes, CU, wall-clock from close → finalize (target ≤ 16 tx, ≤ 60 s on devnet, ≤ 1.4M CU per proof-verification tx — the base spec's H2, now measured on the stocks build).
- Gate measurement: CU for one PoCD verify; CU for the solvency pair.
- Autonomy: fraction of epochs printed unattended during the overnight devnet run; verifiability: `verifyPrint` success rate (target 1.0).
- Leak audit: an attacker script attempting to recover any size or position from chain data across the run; must fail.

---

## 16. Development Roadmap (compressed phases, gates kept)

**Phase 0 — Freeze (1 hour, tonight).** This document is the freeze. §7 and §12 change only by written amendment noted in the README. Parameter table locked. Avalanche `window-clearing` fixtures copied in.

**Phase 1 — Primitives spike (tonight, timeboxed to midnight). THE GATE.** Confidential mint on localnet with auditor key → `window-elgamal` encrypt/grouped/add/decrypt/BSGS property-tested against `solana-zk-sdk` → throwaway program: accumulate two ciphertexts via Ristretto syscall; verify one `ZeroCiphertext` PoCD of the sum through the ZK ElGamal Proof program into a context account; read back; **measure CU**; confirm the ZK program's feature gate is live on devnet.
*Gate green* → Phase 2. *Gate red (proof path)* → the base spec's own pivot: administrator-**attested** prints (B2), everything else identical, proofs as roadmap — decided the same night, stated in the README. *Gate catastrophically red (primitives unusable)* → the shelved Nightwatch v6 plan resumes at dawn; named once here, never again.

**Phase 2 — Auction + oracle (Day 1).** `window_registry`, `window_auction` (context consumption at submit, accumulation, slot gates), `window_oracle` (identity shortcut, bounds, recompute, consumption). Gate: a full epoch of encrypted bids from 5 scripted agents prints on localnet with ρ = 1; attack tests 1–5 green.

**Phase 3 — Wrap + priced credit (Day 2, morning→afternoon).** `window_wrap` + mock-xStock mint (extension mirror) + `PriceCache` + `window_credit` with the priced solvency pair, two-step lock, attested funding, repay, price-fresh permissionless seize. Gate: borrow→repay and borrow→seize green; attack tests 6–8 and all invariants green.

**Phase 4 — Services + devnet (Day 2, evening).** Single `admin` binary (administrator/keeper/operator/price-poster), agents, indexer with `/verify/:epoch`. Gate: **deployed to devnet and printing autonomous epochs before midnight — the market runs overnight unattended.**

**Phase 5 — Lens + dashboard (Day 3, morning→midday).** SDK `verifyPrint` + `verifySolvency`; dashboard: market home (rate + countdown), explorer split-screen with local re-verification badge, borrow desk, positions. Gate: a judge-shaped walkthrough completes on devnet from a clean wallet.

**Phase 6 — Freeze and submit (Day 3, afternoon).** Measurements into README; upgrade authority → None; tag; 3-minute video; submit ≥ 4 h before deadline. Gate: clean clone reproduces one epoch on localnet with `make demo`.

---

## 17. Calendar (Tue 15 Sep, now → Fri 18 Sep 16:00 UTC)

| When (IST) | Phase | Checkpoint |
|---|---|---|
| **Tue 15, tonight → 00:00** | 0 + 1 | Mechanism frozen; **the gate** run and measured; green/B2/abort decided **tonight** |
| Wed 16, 09:00–21:00 | 2 | Full encrypted epoch prints on localnet, ρ = 1; attack tests 1–5 green |
| Wed 16, 21:00–01:00 | 3 start | `window_wrap` + mock mint + PriceCache scaffolded |
| Thu 17, 09:00–17:00 | 3 | Priced solvency green; lifecycle green; attack tests 6–8 + invariants green |
| Thu 17, 17:00–00:00 | 4 | **Devnet deployed; autonomous epochs printing by midnight; overnight unattended run begins** |
| Fri 18, 08:00–13:00 | 5 | Dashboard + lens complete; judge walkthrough passes; overnight-run stats captured |
| Fri 18, 13:00–19:00 | 6 | README + measurements; freeze (authority → None); video; **submit by 21:30 IST (16:00 UTC)** |
| Fri 18, 19:00–01:30 | buffer | 4-hour buffer to the 20:00 UTC hard deadline; nothing new merges |

If any phase slips ≥ 3 hours, apply the cut order in §22 immediately rather than compressing the buffer.

---

## 18. Solo Execution Order (replaces the two-dev split)

The base spec's code-review rule (reviewer runs the gate from a clean clone) cannot hold solo; its replacement disciplines are: (a) every gate is executed **from a clean clone** before the phase is called done, (b) attack tests are written *before* the code they attack where feasible, (c) nothing merges after the Phase-6 freeze.

Order (base spec's solo prescription, adapted): Phase 1 gate → auction → oracle → **indexer skeleton early** (so every later phase is observable) → wrap + credit → admin service → dashboard → measurements. The base spec's instruction "drop the B1 transparent baseline before dropping the S4 attack tests" is inherited in spirit: **the behavioral experiment is already dropped; the attack tests are never dropped.**

---

## 19. Three-Minute Judge Demo Script

| Time | Screen | Words |
|---|---|---|
| 0:00–0:25 | explorer of a transparent lending tx | "This is what borrowing against your stocks on-chain looks like today: your position, your leverage, your liquidation level — public, forever, to everyone who trades against you. Your brokerage would never do this to you. It's why 95% of $684M in tokenized stocks never comes on-chain. In TradFi, margin lending works *because it's private*." |
| 0:25–0:50 | market home on devnet, epoch counting down | "This is the private version, live on devnet. Every two minutes, members bid to borrow or lend at a public rate with an *encrypted* size; the program sums the ciphertexts without decrypting anything, and the market prints xONIA — the first on-chain borrow rate for tokenized stocks. Nobody is driving it. That print just happened." |
| 0:50–1:35 | borrow desk, wallet connected | "Watch a real borrow. I wrap tokenized stock into a confidential balance, bid, and I'm matched at the rate just printed. Now the part that shouldn't be possible: the program proves my collateral covers 150% of the loan — shares times the public Pyth price times the corporate-action multiplier — without ever seeing the shares or the loan. The price is public. The position is not. USDC drawn. Nothing about my size ever touched the chain in plaintext." |
| 1:35–2:00 | explorer split-screen | "Left: what the chain sees — seventy-four Ristretto ciphertexts. Right: the depth curve and the rate. The administrator decrypted only aggregates and had to post one native zero-knowledge proof per tick; the oracle checked every proof and recomputed the rate itself. This badge? Your browser just re-verified every proof from raw account data." |
| 2:00–2:25 | split replay + attack txs | "The edge case that breaks every naive integration: a 10-for-1 split. Watch the naive valuation crater 90% — and watch our solvency check not blink, because the multiplier lives inside the proof. And here's the administrator trying to cheat — false sum, fake rate, replayed proof — every one rejected on-chain. Here are the transactions." |
| 2:25–3:00 | xONIA overnight time series → title card | "The market ran all night unattended — here's every print, every one re-verifiable. Built entirely from Solana's own confidential balances, proof program, and syscalls. No circuits, no trusted setup. The administrator can decrypt — we say so, like the New York Fed sees every SOFR trade — but it cannot lie. The rate is public. The price is public. The position never was." |

---

## 20. Likely Judge Questions

**"Would real people actually use this?"** The demand shape already exists at scale: securities-based lending is a giant TradFi business *because* it is private, and on Solana 95% of tokenized-stock value sits undeployed while transparent lenders throttle LTVs and caps. This build is the missing shape — brokerage-grade privacy with proofs a brokerage can't offer. The demo's borrowers are disclosed simulations plus a judge-usable real flow; organic demand is the Colosseum phase, not a hackathon claim.

**"Why not just use Kamino?"** On Kamino your collateral, loan, health factor, and liquidation level are public — that's the product surface this replaces. Kamino's own throttling (LTV caps, per-asset debt ceilings) is the incumbent's admission that transparent stock collateral is hard to underwrite at size.

**"The administrator can see everything. How is that private?"** Exactly as private as SOFR, whose administrator sees every repo trade. The difference: our administrator's every published number is proven per tick on-chain — it can see, but it cannot lie. Threshold decryption is the stated §23 extension, not a claim.

**"What if the price keeper lies or goes stale?"** Every PriceCache entry names the public 24/7 Pyth feed and its publish time — anyone can compare. Staleness halts credit actions in both directions: a stale price can neither admit a loan nor seize one. On-chain receiver reads close the surface fully and are roadmap (or landed, if the stretch cleared).

**"What about a stock split mid-loan?"** The rebasing multiplier is a public scalar *inside* the solvency proof, so valuation tracks the rebase by construction — the encrypted share count never changes. We demo exactly this: naive valuation shows −90%; the proof verdict is unchanged.

**"How do you know aggregates will decrypt? What about garbage bids?"** Every bid carries a validity proof and a range proof at submission; the program will not accumulate anything that isn't a well-formed encryption of a bounded value. Claimed sums are bounded by bid count × range at finalize.

**"How many transactions does a print cost?"** Measured and reported (target ≤ 16 tx, ≤ 60 s; zero ticks need no proof, so thin epochs are cheap). Regressions are printed in the README, not hidden.

**"Is the loan actually funded for the right amount?"** Attested in this build: the administrator decrypts the transfer's auditor ciphertext and attests; the program enforces lifecycle, not magnitude. §23's equality-proof extension closes it.

**"Are these real xStocks?"** Devnet mocks mirroring the real Token-2022 extension layout, including the rebasing multiplier — stated in §14. Wrapping real mainnet xStocks is the first roadmap item and changes no program logic.

**"Why should anyone reference xONIA?"** Nobody should yet — it's a devnet rate from simulated members. The claim is narrower and demonstrated: the mechanism produces a borrow rate for tokenized equities that is reproducible from chain state and administrator-proof, at a measured cost.

**"Where is the trusted setup?"** There is none. Sigma proofs and range proofs in the ZK ElGamal Proof program are transparent.

**"What happens if the ZK program is paused again?"** Prints and credit halt safely; stale is reported; no funds move without proofs. Listed as a platform dependency.

---

## 21. Competitive Positioning

Acknowledged related work: Token-2022 Confidential Balances (the substrate); Kamino-class transparent lending against xStocks (the incumbent whose throttling proves the problem); Arcium/MPC confidential DeFi on Solana (general confidential compute — no auction, no proven benchmark, no priced solvency); Zama/Fhenix on EVM (confidential lending designs, no published rate, custom-circuit stacks); IPOR/Treehouse (benchmarks from public inputs); Gnosis Auction (uniform price, public bids); THE WINDOW on Avalanche (this team's own prior build). Within Stocklana's visible field: DCA/basket/analytics entries crowd the Investing and Trading wedges; Credit & Yield and privacy are empty.

**The differentiated claim, demonstrated through code:** *the first private credit market for tokenized stocks — encrypted positions valued against a public oracle inside the proof itself — printing the first on-chain borrow rate for tokenized equities, with every published number proven by Solana-native sigma proofs, no custom circuits, no trusted setup.*

---

## 22. MVP Scope

**Must contain**
- Confidential wrapped mints (cUSDC-W loan leg; cSTOCK-W collateral leg wrapping a mock xStock that mirrors real Token-2022 extensions incl. the CA multiplier); one-click confidential-account onboarding.
- `window_registry`, `window_wrap`, `window_auction`, `window_oracle`, `window_credit` on devnet, **immutable at submission**.
- Range-proven, validity-proven encrypted bids; homomorphic accumulation; slot-gated epochs.
- PoCD per nonzero tick via the ZK ElGamal Proof program; identity shortcut; on-chain r\* recompute; bounds; context consumption.
- **Priced solvency**: equality + range proof pair over E_Δ = (100·p·a)·E_c − (150·b)·E_ℓ, with the scalar bound, PriceCache freshness at lock and seize, and rebase safety.
- Two-step lock; attested funding and repay; price-fresh permissionless seize.
- One admin service (disclosed single key), scripted agents (labelled), indexer with `/xonia` and `/verify/:epoch`, SDK `verifyPrint` + `verifySolvency`.
- Dashboard: market home, explorer with local re-verification badge, borrow desk, positions.
- Attack tests 1–8 and the invariant suite, green in CI; measurements in README.
- `METHODOLOGY.md` (leak budget, trusted surfaces), `THREAT_MODEL.md`, honest-limitations README verbatim from §14.

**Must not contain (non-goals)**
- Participation privacy or anonymous membership · threshold administrator · contract-enforced funding magnitude · intra-tenor margin calls or liquidation engine · term tenors / rate curve · variable haircuts · multi-asset collateral baskets · secondary loan market · governance token or fees · mainnet deployment or real value · automatic band recentering · any claim of "trustless" or "undecryptable" · the B1/B2 behavioral experiment (deferred, stated).

**Cut order under schedule pressure** (apply top-down; never touch the bottom row):
receiver-read stretch → unwrap flow (repay releases to confidential balance; unwrap = roadmap) → positions page → lender-side UI (agents carry ASKs) → auditor-rotation demo.
**Never cut:** the gate's proof path (unless the gate itself forced B2) · attack tests · priced solvency with the CA multiplier · autonomous devnet epochs · explorer re-verification · the judge-signable borrow flow · the honest-limitations README.

---

## 23. Post-Hackathon Extensions

- **Real xStocks wrapping (first).** Point `window_wrap` at mainnet xStocks mints; program logic unchanged; adds real-asset custody considerations and the audit gate below.
- **Contract-enforced funding magnitude.** Lender's confidential Transfer in the same transaction as `confirm_funding` plus a `CiphertextCiphertextEquality` proof between the transfer's auditor ciphertext (lo + 2^16·hi combined homomorphically) and the loan ciphertext. Closes the attested surface.
- **On-chain price reads.** `pyth-solana-receiver` consumption replaces the keeper cache; identical downstream math.
- **Intra-tenor risk.** Margin-call instruction (top-up against the same priced proof) and partial seize; haircuts calibrated per-asset from recorded volatility (the Nightwatch recorder architecture is the data source).
- **Threshold administrator.** Split the auditor secret; partial decryptions with Chaum–Pedersen proofs combined before the existing PoCD. Ristretto ElGamal is threshold-friendly.
- **Anonymous membership.** Merkle-set membership with per-epoch nullifiers via the alt_bn128 syscalls; hides participation. New circuit and trusted setup — the one extension that reintroduces circuits, priced accordingly.
- **Term tenors and a curve.** Parallel books per tenor; xONIA 1D/7D.
- **The research program.** The base spec's B1/B2/T behavioral experiment, run at Colosseum scale with REPORT.md — the shading/participation result is the accelerator's science exhibit.
- **Real USDC confidential extension** when Circle enables it; drop the wrapper.
- **Mainnet** after an external audit of the programs and every proof-consumption path.

---

## 24. Project Submission Description

> **THE WINDOW for Stocks** is a private margin desk for tokenized equities on Solana, printing **xONIA** — the first on-chain overnight borrow rate for tokenized stocks. Holders wrap xStocks-style Token-2022 collateral into confidential balances and borrow USDC through a sealed-bid uniform-price auction: bids carry encrypted sizes, an on-chain program sums the ciphertexts without decrypting, and an accountable administrator holding the mint's auditor key must prove every published aggregate with Solana's native ZK ElGamal proofs — the oracle recomputes the clearing rate itself, so a valid proof with a wrong rate is rejected. Collateral solvency is proven homomorphically against the public 24/7 Pyth price with the corporate-action multiplier inside the check: a stock split can neither fake nor destroy coverage, and the position size never appears on-chain. No custom circuits, no trusted setup. The administrator can decrypt, and we say so; what it cannot do is lie. Live on devnet, printing autonomously, every print and every loan re-verifiable from account data. In TradFi, margin lending works because it is private; on a transparent chain it was impossible. Now it isn't. The rate is public. The price is public. The position never was.

---

## 25. Final Pitch

Owning tokenized stocks should be at least as good as a brokerage account — and today it isn't, because using them as collateral means undressing in public. Ninety-five percent of the asset class sits idle for exactly that reason. THE WINDOW for Stocks rebuilds the private margin desk in ciphertext on Solana's own primitives: encrypted positions, an on-chain sum, a priced solvency proof where the price is public and the position is not, an accountable administrator whose every decryption is proven, and a borrow rate — xONIA — that anyone can re-verify from chain state alone. We measured what it costs, we wrote down what we trust, and we shipped the attacks that fail. The rate is public. The price is public. The position never was.