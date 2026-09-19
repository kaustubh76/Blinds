# THE WINDOW for Stocks

**A private margin desk for tokenized stocks on Solana: encrypted bids and collateral in Token-2022 Confidential Balances, homomorphically summed on-chain with curve25519 syscalls, cleared by a uniform-price auction whose every published aggregate is proven with the native ZK ElGamal Proof program, and a priced solvency proof that values hidden collateral against the public Pyth price with the corporate-action multiplier inside the proof.**

Tagline: **The rate is public. The price is public. The position never was.**

One-line explanation: Holders of tokenized stocks borrow USDC against them through a sealed-bid overnight auction in which sizes, loans and collateral are never on-chain in plaintext, yet the clearing rate (**xONIA**, the xStocks Overnight Index Average) and the solvency of every loan are proven on-chain and re-verifiable by anyone from account data alone.

| | |
|---|---|
| Document | Build specification v2 — the frozen mechanism of `SPEC.md` plus the nine written amendments (`SPEC_AMENDMENTS.md`) and the verified engineering. This is the document the code is built against. |
| Event | Stocklana · $100K · Solana Foundation · deadline **Fri 18 Sep 2026 20:00 UTC** · target submit 16:00 UTC |
| Wedge | **Credit & Yield** — "borrowing against stocks"; Infrastructure (rate + proofs) secondary |
| Build | Fresh, independent Solana build. Solo · Anchor 1.1.2 · devnet · ~3.5 days |
| Verification status | Toolchain pinned and proven: the full proof path (`submit_bid` with introspected validity proof + context-account range proof + syscall accumulation + CPI close; `attest` with an introspected proof-of-correct-decryption bound to the on-chain accumulator; the priced solvency pair) was compiled with the installed Anchor CLI and **executed on SBF** inside LiteSVM against the real ZK ElGamal Proof program. Numbers in §15. |
| Honest-claims rule | Never "trustless", "undecryptable", "nobody can see". The administrator **can** decrypt individual amounts. The public sees aggregates, the price and the rate — each proven or publicly attributable. Enforced in CI (`scripts/check_claims.sh`). |

---

## 1. Executive Summary

**Core problem being solved.** Observable borrowing kills lending markets, and observable *collateral* kills securities lending twice over. In traditional finance, margin lending against stocks is a multi-hundred-billion-dollar business precisely because it is private: the broker sees the position and the loan; the world sees nothing. On a transparent blockchain the disclosure lag is zero and the tax is total — borrowing USDC against TSLAx in any transparent protocol broadcasts, permanently and in real time, the position size, the leverage, the liquidation level and the urgency to every counterparty. The measured consequence on Solana: roughly $684M of tokenized-equity supply across 727,000+ holder addresses, of which only ~5% is deployed in DeFi. Incumbent lenders cope by throttling — 60–75% loan-to-value and $1–5M per-asset debt caps against a $684M asset class. The serious size stays off-chain because coming on-chain means being seen.

**Limitations of existing approaches.** Transparent lending protocols cannot hide the position and therefore cannot serve size. Confidential tokens alone hide balances but have no auction, no clearing rule, no benchmark, and no way to *value* hidden collateral against a moving price. Off-chain rate oracles republish public inputs anyone could compute and earn nothing. General confidential-compute stacks (MPC, FHE) require custom circuits, trusted setups or off-chain committees, and none ships a proven, re-verifiable benchmark rate.

**The control loop this system creates.** Every epoch (~2 minutes on devnet), registered members submit borrow bids and lend offers at public rate ticks with **encrypted sizes**. An on-chain program adds the ciphertexts per tick with curve25519 syscalls, decrypting nothing. At close, an accountable Benchmark Administrator — holder of the confidential mints' auditor key — decrypts the **per-tick aggregates only**, computes the uniform clearing rate r\*, and attests each aggregate with one native `ZeroCiphertext` proof that the claimed sum is the true decryption of the frozen on-chain accumulator. The oracle program verifies every proof through Solana's ZK ElGamal Proof program, recomputes r\* itself from the proven aggregates, and prints **xONIA**. A valid proof with a wrong rate is rejected. Matched loans lock **tokenized-stock collateral** behind a priced solvency proof: shares × public Pyth price × corporate-action multiplier ≥ 150% of the loan, proven homomorphically without revealing either amount. Loans settle as confidential transfers; defaults are seized permissionlessly at the deadline. The next epoch opens and members bid against the rate just printed.

**Clear objective.** Success is (a) a borrow flow a judge completes from a wallet in under two minutes with the position never appearing in plaintext — *and a test suite that fails if it ever does*; (b) a benchmark rate any third party re-verifies from chain state alone; (c) an administrator that structurally cannot shape the rate; (d) a bounded, measured cost per print. The project does **not** maximize TVL or yield, does not claim to hide *who* participates, and does not custody real value.

---

## 2. The Central Research Question

> **Can a private securities-financing market — encrypted stock collateral, encrypted bid sizes, a uniform-price auction cleared from homomorphic aggregates, and a priced solvency proof against a public oracle — run end-to-end on Solana's native confidential-token primitives, producing a borrow rate for tokenized equities that is fully reproducible from on-chain state, at a bounded and measured cost per print, with the position never appearing in plaintext?**

This makes THE WINDOW for Stocks more than another confidential-token demo. It becomes a reproducible market-microstructure and systems experiment: the mechanism is specified as math, implemented once, and every claim about it is measured.

Three sub-questions:

1. **Composition** — do Token-2022 grouped ciphertexts, curve25519 syscalls and the ZK ElGamal Proof program compose into proof-of-correct-decryption of a homomorphic sum, at measurable compute cost? **Answered before Phase 1:** yes; the full path was built with Anchor and executed on SBF (§15, "Gate results").
2. **Priced solvency** — can a public scalar (price × multiplier) enter the homomorphic solvency check so that volatile, rebasing collateral is valued safely without decryption? **Answered in the same gate:** yes, with the corrected units of §7.3; an undercollateralized borrower cannot construct the proof pair.
3. **Behavioral** — does removing size observability reduce strategic bid shading versus a transparent auction? **Deferred** to the post-hackathon research phase and stated as such (§15).

The project must measure whether the mechanism works instead of relying on a narrative: every print's transaction count, bytes and compute units are recorded; every attack in §13 has a test that must fail on-chain; the leak budget of §12 has a test that scans the chain.

---

## 3. Why the Name "THE WINDOW"?

The Federal Reserve's discount window is the facility banks borrow from when short overnight — and the best-documented case of a lending facility crippled by the fear of being *seen* using it (a 44 bp premium paid to avoid it in 2007–08, 126 bp after Lehman; the stigma is documented as alive in a 2024 New York Fed staff report). THE WINDOW is that facility rebuilt so that the borrowing is private and only the rate is public. *For Stocks* narrows it to the securities-financing version: the private margin desk.

**xONIA — the xStocks Overnight Index Average** — follows SONIA and EONIA (the sterling and euro overnight index averages): the overnight rate for borrowing dollars against tokenized equities, discovered by auction from encrypted bids.

What the name is **not** claiming: this is an economic analogy, not a Federal Reserve product, not a bank, not a broker-dealer, and not a regulated benchmark. xONIA is a devnet reference rate produced by a hackathon-scale market with disclosed simulated participants. The SOFR/SONIA comparison is one of governance *shape* — confidential inputs, accountable administrator, public aggregate — not of scale or legal standing. "xStocks" names the asset family the mechanism targets; the demo uses mock mints mirroring their Token-2022 layout (§14).

---

## 4. Why This Fits Stocklana

The brief: *"Tokenized stocks already trade on Solana. Build what makes owning and using them better than today's brokerage app. Pick one wedge and make it excellent."* Judging is one question — **could this be a real app that people will actually use?** — decomposed into a real user and problem, a working end-to-end demo, a reason it belongs on Solana, and quality of execution.

| Judging component | How this build answers it |
|---|---|
| **Wedge discipline** | One wedge — Credit & Yield, "borrowing against stocks", verbatim from the brief. The rate and the proofs serve that wedge rather than dilute it. |
| **Real user & problem** | The tokenized-stock holder with meaningful size: 727K+ addresses, $684M supply, ~95% undeployed because on-chain borrowing exposes the position. TradFi proves the demand shape: securities-based lending is enormous *because* it is private. |
| **Better than the brokerage app** | Same privacy as a brokerage margin account, **plus** what no brokerage shows: a market-discovered, administrator-proof public borrow rate, and cryptographic proof that every published number is true. |
| **End-to-end demo** | Live devnet market printing xONIA autonomously every ~2 minutes; a judge connects a wallet, wraps mock-TSLAx, bids, is matched, locks collateral behind the priced proof, draws USDC — every beat a signed transaction; the explorer re-verifies every sigma proof in the browser. |
| **Why Solana** | Every layer is a Solana-native primitive used as designed: Token-2022 Confidential Transfers as market inputs; the mint auditor key as the administrator role; curve25519 syscalls for accumulation; the ZK ElGamal Proof program as trust anchor; Pyth's 24/7 xStocks feeds as the public valuation scalar; the Token-2022 `ScaledUiAmount` extension as the corporate-action multiplier. No circuits, no trusted setup, no bridge. This composition exists on no other chain. |
| **Execution quality** | On-chain attack tests (false sum, false rate, replay, missing proof, oversized bid, undercollateralized borrow, stale price, rebase replay — all rejected); the rebasing multiplier handled *inside the solvency proof*; privacy enforced by a leak-audit test; limitations stated verbatim in the README; every dependency pinned and proven to build. |

Alignment with the broader roadmap: the build uses only primitives Solana has shipped and activated (SIMD-0153 ZK ElGamal Proof program, curve25519 syscalls, Token-2022 confidential transfers and `ScaledUiAmount`), which is the direction the ecosystem's confidential-asset work is taking.

---

## 5. Connection to Official / Existing Ideas

| Prior concept | What it provides | This build's extension |
|---|---|---|
| **Token-2022 Confidential Transfers / Confidential Balances** | twisted ElGamal ciphertexts over Ristretto; pending/available encrypted balances; an auditor key per mint; native deposit/withdraw/transfer proofs | uses the ciphertexts as *auction inputs and collateral claims*, and the auditor key as the *benchmark-administrator role*; sums ciphertexts across accounts inside a program |
| **ZK ElGamal Proof program** (`ZkE1Gama1Proof11111111111111111111111111111`, active on devnet since epoch 801 and on mainnet) | verifies sigma proofs — zero-ciphertext, ciphertext–commitment equality, grouped-ciphertext validity, batched range proofs — either inline (read from the same transaction through the Instructions sysvar) or into context-state accounts | composes `ZeroCiphertext` into proof-of-correct-decryption of an aggregate, and `CiphertextCommitmentEquality` + `BatchedRangeProofU64` into a **priced** solvency proof — no custom circuits |
| **curve25519 syscalls** (`sol_curve_group_op`, `sol_curve_multiscalar_mul`) | cheap Ristretto addition, subtraction and scalar multiplication on-chain | homomorphic accumulation of bids per tick; the residual `C − v·G` a proof is bound to; **scalar-weighted valuation** `k_c·E_c − k_l·E_ℓ` |
| **Pyth xStocks feeds** (`TSLAXUSD`-class, 24/7 schedule) | public, always-on reference prices for the tokenized-stock mints | the **public scalar** inside the confidential solvency proof |
| **xStocks on Token-2022** (Token-2022 mints with metadata and a rebasing multiplier via the `ScaledUiAmount` extension) | the collateral asset family and its integration landmine | the multiplier is read from the mint's `ScaledUiAmountConfig` and folded *into the solvency scalar*, so a split can neither fake nor destroy coverage |
| **SOFR / SONIA administration** | confidential transaction inputs, accountable administrator, public aggregate, IOSCO-style oversight | the same shape with the administrator's honesty *proven per print* rather than institutionally trusted |
| **Uniform-price sealed-bid auctions** (treasury auctions) | one clearing price, pro-rata at the margin | bids stay encrypted *after* clearing; clearing is recomputed on-chain from a proven curve |
| **This team's prior private-lending build on another chain** (custom circuits, trusted setup, same-asset collateral) | validated the mechanism shape: encrypted bids, homomorphic sums, proven prints | *conceptual lineage only*: this repository shares no code, fixtures, tests or documents with it; native sigma proofs replace circuits; range-proven bids; **priced, rebase-safe stock collateral** |

---

## 6. What Makes THE WINDOW for Stocks Different?

**vs. transparent stock-collateral lending (Kamino-class).** The incumbent proves the problem: throttled LTVs and single-digit-million debt caps against a $684M asset class, because transparent collateral invites being traded against and the lender prices that in. Here the position is encrypted end-to-end, and the *rate* is discovered by auction instead of set by a utilization curve.

**vs. a confidential token alone (Token-2022 CT, MPC-wrapped assets).** A confidential token hides balances. It has no auction, no clearing rule, no benchmark, and no way to *value* hidden collateral. This build is the first thing that does something with the ciphertexts: it clears a credit market, values encrypted stock against a public price, and proves everything it publishes.

**vs. transparent rate oracles (IPOR-class).** Those republish public inputs; anyone could compute them, so the category earned nothing. xONIA aggregates information *not observable any other way* — encrypted bid depth — which is the only condition under which a benchmark administrator has a durable role.

**vs. the prior build on another chain.** Same mechanism, better substrate, harder collateral: no custom circuits, no trusted setup, no contract-size chunking; range-proven bids at submission; syscall accumulation; and the priced, rebase-safe solvency proof that stock collateral demands.

| | Transparent stock lending | Rate oracle (IPOR-class) | Confidential token alone | **THE WINDOW for Stocks** |
|---|---|---|---|---|
| Position hidden | no | n/a | yes | **yes — tested** |
| Market cleared from hidden inputs | no | no | no | **yes** |
| Published curve proven on-chain | n/a | no | n/a | **yes (native sigma proofs)** |
| Volatile, rebasing collateral valued without decryption | no (public) | n/a | no | **yes (priced solvency)** |
| Bid well-formedness enforced at submit | n/a | n/a | yes | **yes (validity + range proof)** |
| Custom circuits / trusted setup | no | no | no | **none** |
| Benchmark output | utilization APY | mirror of public data | none | **xONIA** |

---

## 7. Core Mechanism

Notation: `G`, `H` are the fixed independent Ristretto generators used by Token-2022; a keypair is `(s, P)` with `P = s⁻¹·H`; encrypting `m` with randomness `r` gives the twisted ElGamal ciphertext

$$C = m\,G + r\,H,\qquad D_P = r\,P.$$

A **grouped** ciphertext shares `C` with one decrypt handle per recipient: `(C, D_member, D_auditor)`. Amounts: bid/loan sizes in **micro-USDC** (`µUSDC`, 10⁻⁶ USDC); collateral in **milli-shares** (10⁻³ share); slots ≈ 400 ms.

### 7.1 Observation / Input Capture

Every relevant event is account state plus an Anchor `emit!` log, so the indexer never replays heavy computation. **No event and no instruction argument ever carries a size** (§12).

**Membership.** `window_registry` holds a `Member` PDA per member: `(owner, elgamal_pubkey, joined_epoch, active)`. Admission is admin-gated for the hackathon. A member's ElGamal key is derived from a wallet signature over `"ElGamalSecretKey" ‖ "thewindow:member:v1"` — the same derivation Token-2022 tooling uses — so the browser, the agents and the CLI agree on it. Members hold Token-2022 accounts with the Confidential Transfer extension on **two mints**: `cUSDC-W` (confidential wrapped USDC — the loan leg) and `cSTOCK-W` (confidential wrapped mock-xStock — the collateral leg). One-click onboarding configures both.

**Wrap.** `window_wrap::wrap(amount)` pulls mock-xStock via `transfer_checked` (Token-2022, extensions respected) into program custody, mints `cSTOCK-W` 1:1 to the member's token account, and CPIs the Token-2022 confidential `Deposit` (public → pending balance; owner-signed, **no proof required**). The member then runs `ApplyPendingBalance` client-side (no zero-knowledge proof either — only the owner's new AE-encrypted decryptable balance). `unwrap` reverses it after a client-side confidential `Withdraw`. Invariant: `cSTOCK-W.supply == custody.amount == vault.wrapped`, asserted in tests. *The wrap amount is visible in this transaction* — it is a public token leg, like funding a brokerage account; see the leak budget in §12.

**Price cache.** The keeper posts `(price, expo, publish_time)` from the named public Pyth 24/7 xStocks feed into a `PriceCache` PDA at least once per epoch. Solvency and seize instructions require `slot − posted_slot ≤ max_price_age`. Provenance is attested (feed id and publish time on-chain for anyone to compare); an on-chain receiver read is a stretch goal with an identical downstream path.

**Epoch clock.** `open_epoch` / `close_epoch` are keeper-gated but slot-gated: close requires `slot ≥ start_slot + epoch_slots`; after `keeper_grace_slots` any signer may close, so a dead keeper cannot freeze the market. `open_epoch` stamps the current auditor public key into the `Epoch` account (§7.4).

**Bid.** During an `Open` epoch a member submits `(side, tick)` with a grouped ciphertext of the size:

- `side ∈ {ASK, BID}` and `tick ∈ [0, 36]` are **public**. Tick `t` maps to `100 + 25t` bp: the band is 1.00%–10.00% at 25 bp. BID = borrow USDC (stock collateral); ASK = lend USDC.
- The ciphertext is a **grouped twisted ElGamal ciphertext with two decrypt handles** — `(member, auditor)` in that order — sharing a Pedersen commitment to the size.
- Two proofs accompany it: `GroupedCiphertext2HandlesValidity` (well-formed under both keys; 320 bytes; verified **inline** in the same transaction and read by the program through the Instructions sysvar) and `BatchedRangeProofU64` that the size lies in `[s_min, s_min + 2^40)`, proven on `(s − s_min)` with bit lengths `[40, 24]` (the second commitment is a random-opening commitment to zero; 936 bytes; verified in its **own transaction into a context-state account** whose authority is the member).

The program checks both contexts (owner = ZK program, proof type, `context_state_authority == member`), checks `validity.first_pubkey == Member.elgamal_pubkey` and `validity.second_pubkey == Epoch.auditor_pubkey`, recomputes `C − s_min·G` with one scalar-multiplication and one subtraction syscall and requires it to equal the range proof's first commitment with bit length 40, accumulates `(C, D_auditor)` into the epoch's per-tick accumulator with two addition syscalls, stores the ciphertext in a `Bid` PDA (`init` enforces one bid per member per side per tick per epoch), closes the range context by CPI (rent back to the member), increments `bid_count[side][tick]`, and emits `BidSubmitted { epoch, member, side, tick }`.

Client transaction sequence for one bid (all built by the SDK): **tx 1** create the range context account (system program); **tx 2** `VerifyBatchedRangeProofU64` into it (1,141 bytes measured); **tx 3** `[VerifyGroupedCiphertext2HandlesValidity, submit_bid]` (676 bytes measured, ~30k CU).

### 7.2 Delayed / External Signal

The outcome signal is the decrypted depth curve, producible only by the administrator (holder of the auditor ElGamal secret). Off-chain, on `EpochClosed`:

1. Read the 74 accumulators (2 sides × 37 ticks) and bid counts from the `Epoch` account.
2. For each nonzero accumulator `(C_t, D_t)`, compute `C_t − s·D_t = v_t·G` with the auditor secret `s` and recover `v_t` by baby-step giant-step over `[0, n_t·2^40]` (giant steps walk upward from zero, so realistic sums decode in microseconds).
3. Build the cumulative curves and compute r\* with `window-clearing` (§7.3).
4. Generate one `ZeroCiphertext` proof per nonzero accumulator over the residual `(C_t − v_t·G, D_t)`.
5. Submit the print in three kinds of transaction: `begin_print(epoch)`; `attest_ticks(claims)` batches — each transaction carries up to `attest_batch` inline `VerifyZeroCiphertext` instructions (192 bytes each) followed by the `attest_ticks` instruction that reads them through the Instructions sysvar; and `finalize_print(epoch, claimed_r_star)`.

**Validation rules the programs apply:**

- *Coverage.* `begin_print` snapshots a `nonzero_bitmap` from `bid_count` and requires every zero-count accumulator to be the identity point. `finalize_print` requires `proven_bitmap == nonzero_bitmap` and `claimed_sum == 0` for every zero tick.
- *Binding.* For each claim `(side, tick, sum)`, `attest_ticks` recomputes the residual `(C_t − sum·G, D_t)` from the **frozen** accumulator and requires the proof context's ciphertext to equal it and its public key to equal `Epoch.auditor_pubkey`. A proof for any other epoch, tick or sum cannot match. A tick can be attested once.
- *Bound.* Every claimed `v_t ≤ n_t·2^40` (every contributing bid was range-proven).
- *Recompute.* `finalize_print` runs the clearing rule on the attested sums and rejects the call if the result differs from `claimed_r_star` (including "no trade").
- *Uniqueness.* One `Print` PDA per epoch; `finalize_print` is final; `mark_printed` in the auction program requires `Closed`.
- *Freshness.* No finalize within `stale_after_slots` of close → anyone may call `mark_stale(epoch)`: the print is flagged `missed`, the benchmark carries the last rate with `stale = true` and `τ` incremented; the next epoch opens regardless; a late `finalize_print` remains allowed (its proofs bind to that epoch's frozen accumulators).

### 7.3 Core Calculation

**Homomorphic accumulation.** For side σ and tick t, after n bids:

$$C^\sigma_t = \sum_i C_i = \Big(\sum_i m_i\Big)G + \Big(\sum_i r_i\Big)H,\qquad D^\sigma_t = \sum_i D_{\text{auditor},i} = \Big(\sum_i r_i\Big)P_{\text{aud}}.$$

Two Ristretto additions per bid via syscall. The identity pair means "never accumulated".

**Decryption (administrator only).** With auditor secret `s`: $C^\sigma_t - s\,D^\sigma_t = v^\sigma_t\,G$, and `v` is recovered by BSGS over `[0, n_t·2^40]`.

**Proof of correct decryption (PoCD).** Publishing `v` is a claim; the proof is that the residual encrypts zero under the auditor key:

$$(C^\sigma_t - v^\sigma_t\,G,\; D^\sigma_t) \in \mathrm{Enc}_{P_{\text{aud}}}(0),$$

exactly the ZK ElGamal Proof program's `ZeroCiphertext` sigma proof. The verifier program reconstructs the residual itself from the on-chain accumulator and the claimed `v`; the administrator supplies nothing but `v` and the proof.

**Uniform-price clearing** (implemented once in `window-clearing`, `no_std`, run on-chain by the oracle and off-chain by everyone else):

$$S(r) = \sum_{t \le r} v^{\text{ASK}}_t,\qquad D(r) = \sum_{t \ge r} v^{\text{BID}}_t,\qquad r^* = \min\{\, r : S(r) \ge D(r) > 0 \,\}.$$

All fills clear at r\*; matched volume `= min(S(r*), D(r*)) = D(r*)`. Because supply covers all demand at r\*, **bids are always fully filled**; supply is filled by price priority. The **marginal tick** is `m = min{ m ≤ r* : S(m) ≥ D(r*) }`; asks below `m` fill fully, asks at `m` fill at the disclosed ratio `(D(r*) − S(m−1)) / v^ASK_m`, asks above `m` get nothing. The ratio is public (same for every ask at `m`) and reveals no individual size. No such `r` → **no trade**; the last print is carried with `stale = true`.

**Priced collateral solvency** (the one piece of new mathematics; units corrected — amendment A3). Collateral ciphertext `E_c` encrypts the share count `c` in milli-shares, range-proven `c < 2^32`. Loan ciphertext `E_ℓ` encrypts `ℓ` in micro-USDC, range-proven `ℓ < 2^40` (it is the bid ciphertext). Public inputs: Pyth price scaled to cents per share, `p′ = ⌊price · 10^(expo+2)⌋`, and the corporate-action multiplier scaled to thousandths, `a = round(multiplier · 10^3)`, read from the mint's `ScaledUiAmount` extension. Collateral value in micro-USDC is

$$V = \frac{c \cdot p' \cdot a}{100}\quad\text{(milli-shares × cents × milli-multiplier = }10^{-8}\text{ USDC = }10^{-2}\text{ µUSDC)}.$$

The 150% requirement `V ≥ 1.5 ℓ` is therefore `c·p′·a ≥ 150·ℓ`, and the program forms, by scalar-multiplication and subtraction syscalls,

$$E_\Delta = k_c\,E_c - k_l\,E_\ell,\qquad k_c = p' a,\quad k_l = 150 .$$

The borrower supplies a fresh Pedersen commitment `K` to `Δ = k_c c − k_l ℓ`, a `CiphertextCommitmentEquality` proof that `E_Δ` and `K` hold the same value, and a `BatchedRangeProofU64` that `K ∈ [0, 2^64)`. Together: collateral value covers 150% of the loan with neither the position nor the loan revealed.

Soundness conditions:
- *Scalar bound:* `k_c·2^32 < 2^63` and `k_l·2^40 < 2^63`, asserted at configuration and re-checked at lock (`window_proofs::scalar::scalar_bound_ok`). An honest `Δ` is then `< 2^63` and provable as a u64; a negative `Δ` wraps modulo the group order to ≈ 2^252 and the U64 range proof rejects it. For the demo asset (`p′ ≈ 40,012`, `a = 1,000`) `k_c ≈ 4.0·10^7 ≪ 2^31`.
- *Rebase safety:* `a` multiplies the **scalar**, not the ciphertext — a 10:1 split changes the public factor and leaves the encrypted shares untouched, so a rebase can neither fake nor destroy solvency.
- *Freshness:* solvency and seize both require `PriceCache` within `max_price_age`; a stale price can neither admit a loan nor seize one.

**Sign conventions and adverse outcomes.** Borrowers benefit from lower r\*; lenders from higher. Administrator deviation `Δ_adm = |r*_claimed − r*_recomputed|` must be 0 on-chain (else the print is rejected); proof coverage `ρ` = proven nonzero accumulators ÷ nonzero accumulators must be 1 at finalize; staleness `τ` = epochs since the last trade print; price age = `slot − posted_slot`, bounded at every credit action.

### 7.4 Aggregation / Epoch Logic

| Quantity | Aggregated over | Purpose |
|---|---|---|
| Per-tick accumulators `(C, D)` and counts `n^σ_t` | one epoch | inputs to the print |
| `nonzero_bitmap`, `proven_bitmap` (74 bits each) | one epoch | coverage `ρ` |
| Claimed sums `v^σ_t` | one epoch | depth curve and r\* recompute |
| `Epoch.auditor_pubkey` | one epoch | binds proofs to the key in force when bids were made (rotation between epochs only) |
| Print history (r\*, matched, marginal ratio, stale) | all epochs | the xONIA time series |
| Regime state (`stale`, `τ`, streaks, `BandEdge`) | rolling | hysteresis |
| `PriceCache` (`p`, `publish_time`, `posted_slot`) | rolling | valuation freshness |

Primary control metric: **ρ = 1 or no print**. Secondary: **τ** drives the regime. Tertiary: **price age** gates credit actions. Epoch length: 300 slots (~2 min) demo; 20 slots (~8 s) integration-test profile; 9,000 slots (~1 h) production profile.

### 7.5 Controller / Decision Rule

```
finalize_print(epoch, claimed_r_star):
    require proven_bitmap == nonzero_bitmap and claimed_sum == 0 on zero ticks
    r_star = clear(claimed_sums)                      # window-clearing, the only implementation
    require r_star == claimed_r_star                  # else reject, no state change
    if r_star is None:  outcome = NoTrade; carry last rate; stale = 1; tau += 1
    else:               outcome = Printed; print (r_star, matched, marginal ratio); tau = 0
                        consecutive_trades += 1; stale clears only when consecutive_trades >= 2
                        edge/interior streaks update; BandEdge sets after band_edge_epochs edge prints
    CPI auction.mark_printed(epoch, outcome)          # signed by the oracle's ["authority"] PDA

mark_stale(epoch):    anyone; slot >= close_slot + stale_after_slots and not finalized
                      -> Print.missed = 1; stale = 1; tau += 1  (late finalize still allowed)
lock_collateral:      require the four verified contexts AND slot - posted_slot <= max_price_age AND scalar bound
seize:                require slot > deadline_slot AND status == Active AND price fresh
```

**Parameters** (`config/demo.toml`, `config/integration.toml`, `config/prod.toml` — one file per profile, read by the setup scripts, the admin service and the tests):

| Parameter | Demo | Integration | Production | Notes |
|---|---|---|---|---|
| `epoch_slots` | 300 (~2 min) | 20 | 9,000 (~1 h) | slot-gated close |
| `tenor_slots` | 150 | 20 | 54,000 (~6 h) | overnight-style loan life |
| `keeper_grace_slots` | 150 | 10 | 4,500 | anyone may close after |
| `stale_after_slots` | 450 | 40 | 13,500 | print deadline after close |
| `max_price_age_slots` | 75 (~30 s) | 30 | 300 | Pyth 24/7 feed keeps this satisfiable |
| `band_edge_epochs` | 5 | 5 | 24 | flag only |
| `max_bids_per_epoch` | 4,096 | 4,096 | 4,096 | account-size and CU safety |
| `bid_min_micro_usdc` (`s_min`) | 1,000,000 | same | same | 1 USDC; range proof on `(s − s_min)` |
| Tick grid | 37 ticks, 1.00–10.00%, 25 bp | same | same | 74 accumulators |
| Bid size range | `[s_min, s_min + 2^40)` µUSDC | same | same | ≈ 1.1M USDC max per bid |
| `haircut_bps` | 15,000 | 15,000 | 15,000 | illustrative, not risk-calibrated |
| `collateral_bits` | 32 | 32 | 32 | `c` in milli-shares |
| `price_exp` / `mult_exp` | 2 / 3 | same | same | cents / thousandths |
| `attest_batch` | 3 | 3 | 3 | PoCD proofs per `attest_ticks` tx (4 fits only with lookup tables) |
| `bsgs_baby_bits` / `bsgs_max_bits` | 20 / 44 | 20 / 44 | 20 / 48 | ≤ `n_t·2^40` |
| Scalar bound | `k_c·2^32 < 2^63`, `k_l·2^40 < 2^63` | same | same | asserted at config and lock |

### 7.6 Controlled Decay / Hysteresis

Implemented as one pure function, `window_clearing::regime::step(state, outcome, band_edge_epochs)`, stored verbatim in `OracleState`.

- **Stale carry.** A no-trade or missed print carries the last r\* with `stale = 1`; it clears only after **two consecutive** trade prints — one thin epoch cannot flap the benchmark.
- **Missed-print recovery.** The administrator misses `stale_after_slots` → the epoch stays `Closed`, anyone calls `mark_stale`, the next epoch opens anyway, and a late finalize is allowed. Consumers read `stale` and `τ`.
- **Price staleness.** A dead price keeper halts *credit actions only* (no lock, no seize); the auction and prints continue. Loans in flight cannot be seized on stale prices — safety degrades to inaction, never to wrong action.
- **Band-edge.** `BandEdge` sets after `band_edge_epochs` consecutive prints at tick 0 or 36 and clears after the same count of interior prints. Flag only; no auto-recentering.
- **Keeper handoff.** After grace, any signer closes; closing is idempotent per epoch, so no keeper oscillation.

---

## 8. Why the Off-Chain Administrator and the ZK ElGamal Proof Program Are Essential

A pure on-chain program cannot run this market, for structural reasons:

1. **Decryption requires a secret.** Accumulators are ciphertexts under the auditor key; no program can hold that key. Someone off-chain must decrypt, solve the bounded discrete log, and compute the curve.
2. **Proof generation requires the same secret.** `ZeroCiphertext` is a proof of knowledge of `s`; it must be generated where `s` lives.
3. **Solana has no scheduler.** Epochs open and close by keeper transactions on a slot schedule; prices are pushed, not pulled.
4. **A PDA cannot sign a confidential transfer.** Escrow of confidential collateral therefore sits in the operator's confidential account, and only the *source owner* can sign a confidential transfer — which is why the borrower, not the operator, moves collateral into escrow (§8 chain below, amendment A5).

The ZK ElGamal Proof program is what makes the off-chain administrator *accountable*: it verifies the sigma proofs — inline for the print, into context-state accounts for bids and solvency — and the programs consume only verified contexts. Without it the curve is an attestation; with it, the curve is proven.

**Essential jobs** (solo deployment: administrator = keeper = operator = price poster, one disclosed key; the roles remain separate in program design):

| Role (program-level) | Jobs |
|---|---|
| Administrator | decrypt accumulators; BSGS; compute r\* and the ask allocation; generate ≤ 74 sigma proofs; `begin_print`, `attest_ticks` × N, `finalize_print`; decrypt `Bid`s and `post_matches`; attest funding/repayment; never write plaintext sizes to logs or APIs |
| Keeper | `open_epoch` / `close_epoch` on schedule; post `PriceCache` from the named Pyth feed each epoch; `seize` past deadline; low-balance alerts |
| Operator | hold wrapped collateral escrow in a confidential account; `confirm_lock` after the borrower's transfer; `release` / `seize_to` transfers on program events |
| ZK ElGamal Proof program | verify every proof; write context-state accounts or expose inline contexts |
| Indexer | subscribe to logs; rebuild depth, prints, loans; serve `/xonia`, `/depth`, `/loans`, `/verify/:epoch` |

**Causal chain for one epoch**

```
keeper ──open_epoch (stamps auditor key)──▶ Epoch(Open);  keeper ──post_price──▶ PriceCache
member ──wrap(mock-xStock) + Deposit──▶ cSTOCK-W pending ──ApplyPendingBalance──▶ available
members ──[create ctx][verify range → ctx][verify validity + submit_bid]──▶ accumulate, Bid PDA, close ctx
keeper ──close_epoch (slot-gated; anyone after grace)──▶ Epoch(Closed), accumulators frozen
admin ──decrypt, BSGS, r*──▶ begin_print ──▶ [VerifyZeroCiphertext ×k + attest_ticks] × N ──▶ finalize_print
       (identity ticks need no proof; bounds; recompute; regime step) ──CPI──▶ auction.mark_printed
admin ──post_matches @ r* (Full: size_ct = Bid.ciphertext)──▶ Credit: loans Pending
borrower ──[collateral validity, range32, equality, range64 → contexts]──▶ lock_collateral (price-fresh, scalar-bound) ──▶ Requested
borrower ──[CT Transfer to escrow, deposit_collateral]──▶ Deposited; operator ──confirm_lock──▶ Locked
lender ──confidential principal──▶ admin ──confirm_funding (attested)──▶ Active (deadline = slot + tenor)
borrower ──confidential repayment──▶ admin ──repay──▶ Repaid ──▶ operator release (→ unwrap optional)
   or keeper/anyone ──seize (slot > deadline, price-fresh)──▶ Defaulted ──▶ operator seize_to(lender)
indexer ──logs──▶ dashboard, rate feed, /verify;   anyone ──close_bid──▶ rent back to members
```

---

## 9. Smart Contract Architecture

All Anchor 1.1.2 programs, one crate each, program IDs fixed at Phase 0 and identical on localnet and devnet:

| Program | ID |
|---|---|
| `window_registry` | `3Q49UcynVxvbrV9zw4M9bkMKrsQ2x6YvHtY1tgAjgKpi` |
| `window_auction` | `HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6` |
| `window_oracle` | `78Z5vNDsujWjDZjKFp625tZ1QMjD44VEHKCFH3LmzfLV` |
| `window_wrap` | `E2scxVy7CpoxWQRBXsrSteYBbuEeMu7Q4zXYMM5bvLX3` |
| `window_credit` | `3C6zwULWtL7oQHcEQbL9myG2zaJ8CPanRvPrF18ifKcr` |

Shared conventions: one file per instruction under `instructions/`; `state.rs`, `events.rs`, `errors.rs`, `constants.rs`; every gated instruction checks its signer with `has_one`; all arithmetic is `checked_*`; `Epoch` and `Print` are zero-copy accounts; every consumed proof context is checked for owner (ZK program), proof type and `context_state_authority == the user`, then closed by CPI with the user's propagated signature. **No instruction takes a size and no event carries an amount** (§12).

### 9.1 `window_registry`

| Account | Seeds | Fields |
|---|---|---|
| `Config` | `["config"]` | `admin`, `member_count`, `bump` |
| `Member` | `["member", owner]` | `owner`, `elgamal_pubkey: [u8;32]`, `joined_epoch`, `active`, `bump` |

| Instruction | Signer | Rules → errors |
|---|---|---|
| `initialize(admin)` | payer | once |
| `add_member(owner, elgamal_pubkey, joined_epoch)` | admin | `elgamal_pubkey ≠ 0` → `ZeroKey`; emits `MemberAdded` |
| `remove_member` | admin | `active → false` → `NotActive`; emits `MemberRemoved` |
| `update_elgamal_pubkey(new)` | owner | (auction reads the key at bid time) |

### 9.2 `window_auction`

| Account | Seeds | Fields |
|---|---|---|
| `Config` | `["config"]` | `admin`, `keeper`, `oracle_program`, `registry_program`, `auditor_elgamal_pubkey`, `cusdc_mint`, `cstock_mint`, `epoch_slots`, `keeper_grace_slots`, `stale_after_slots`, `s_min`, `max_bids_per_epoch`, `epochs_opened`, `current_epoch`, `has_open_epoch`, `bump` |
| `Epoch` (zero-copy) | `["epoch", index_le]` | `index`, `status: {Open, Closed, Printed, NoTrade}`, `start_slot`, `close_slot`, `auditor_pubkey`, `acc_commitment: [[[u8;32];37];2]`, `acc_handle: [[[u8;32];37];2]`, `bid_count: [[u32;37];2]`, `total_bids`, `bump` |
| `Bid` | `["bid", epoch_le, member, side, tick]` | `epoch`, `member`, `side`, `tick`, `ciphertext: [u8;96]`, `slot`, `bump` |

| Instruction | Signer | Rules → errors |
|---|---|---|
| `initialize(params)` | payer → admin | parameter sanity → `BadParams` |
| `open_epoch` | keeper | `!has_open_epoch`; stamps `auditor_pubkey`, `start_slot`; `index = epochs_opened++` → `PrevEpochStillOpen` |
| `close_epoch(index)` | keeper, or anyone if `slot ≥ start + epoch_slots + grace` | `Open`; `slot ≥ start_slot + epoch_slots`; idempotent → `WindowNotElapsed`, `NotKeeperBeforeGrace` |
| `submit_bid(side, tick)` | member; remaining accounts `[range_ctx]`; Instructions sysvar; ZK program | `tick ≤ 36`; member `active`; validity context read at offset −1 via the sysvar; `first_pubkey == Member.elgamal_pubkey`, `second_pubkey == Epoch.auditor_pubkey`; range ctx owner/type/authority; `range.commitments[0] == C − s_min·G`, `bit_lengths[0] == 40`; `total_bids < max`; accumulate; init `Bid`; close ctx; emit `BidSubmitted{epoch, member, side, tick}` → `NotOpen, BadTick, MemberInactive, MemberKeyMismatch, AuditorKeyMismatch, RangeCommitmentMismatch, RangeBitLength, ContextAuthorityMismatch, BadContextOwner, WrongProofType, TooManyBids, CurveError, AlreadyBidHere` |
| `mark_printed(index, outcome)` | `oracle_authority` PDA (`seeds = [b"authority"]`, `seeds::program = config.oracle_program`) | `Closed → Printed | NoTrade` → `NotClosed`, `Unauthorized` |
| `close_bid` | anyone; rent → `bid.member` | epoch settled ∧ (no `Loan` references it, or the `Loan` account is passed) → `EpochNotSettled`, `BidStillReferenced` |
| `rotate_auditor(new_pubkey)` | admin | `!has_open_epoch` → `EpochOpen` |

### 9.3 `window_oracle`

| Account | Seeds | Fields |
|---|---|---|
| `OracleState` | `["oracle"]` | `admin`, `auction_program`, `last_print_epoch`, `has_printed`, `last_r_star_tick`, `last_matched`, `regime: {stale, consecutive_trades, edge_streak, interior_streak, band_edge, tau}`, `prints`, `bump` |
| `Print` (zero-copy) | `["print", epoch_le]` | `epoch`, `status: {Attesting, Missed, Printed, NoTrade}`, `claimed_sum: [[u64;37];2]`, `nonzero_bitmap: [u8;10]`, `proven_bitmap: [u8;10]`, `attested: u8`, `missed: u8`, `r_star_tick`, `matched_volume`, `marginal_tick`, `marginal_ratio: (u64,u64)`, `stale`, `tau`, `regime_flags`, `finalized_slot`, `matches_posted`, `bump` |
| signer PDA | `["authority"]` | signs `mark_printed` CPIs |

| Instruction | Signer | Rules → errors |
|---|---|---|
| `initialize` | payer → admin | once |
| `begin_print(epoch)` | admin | `Epoch.Closed`; init `Print`; `nonzero_bitmap` from `bid_count`; zero ticks must be identity → `NotClosed, ZeroTickNotIdentity, PrintExists` |
| `attest_ticks(claims: Vec<{side, tick, sum}>)` (len ≤ `attest_batch`) | admin; Instructions sysvar | claim *i* ↔ `VerifyZeroCiphertext` instruction at relative offset `−(len − i)`; `ctx.pubkey == Epoch.auditor_pubkey`; `ctx.ciphertext == (C_t − sum·G, D_t)`; `sum ≤ bid_count·2^40`; bit not yet set → `WrongProofType, ProofKeyMismatch, ResidualMismatch, SumExceedsBound, TickNotNonzero, TickAlreadyAttested, PrintNotAttesting` |
| `finalize_print(epoch, claimed_r_star: Option<u8>)` | admin | `proven == nonzero`; zero ticks sum 0; `clear() == claimed`; `regime::step`; write `Print`; CPI `mark_printed`; emit `Printed{epoch, r_star_tick, matched}` or `NoTrade{epoch}` → `CoverageIncomplete, RateMismatch, AlreadyFinalized` |
| `mark_stale(epoch)` | anyone | `Closed ∧ slot ≥ close_slot + stale_after_slots ∧ !finalized`; `missed = 1`; regime step `Missed` → `NotYetStale, AlreadyFinalized` |

`latest_rate` is a view over `OracleState` (`last_r_star_tick`, `last_print_epoch`, `stale`, `tau`).

### 9.4 `window_wrap`

| Account | Seeds | Fields |
|---|---|---|
| `Vault` | `["vault", mock_mint]` | `mock_mint`, `cstock_mint`, `custody` (ATA of the vault under Token-2022), `wrapped`, `bump` |
| `mint_authority` PDA | `["mint_authority"]` | mint authority of `cSTOCK-W` |

| Instruction | Signer | Rules → errors |
|---|---|---|
| `initialize` | admin | mock mint carries `ScaledUiAmount`; `cSTOCK-W` has the Confidential Transfer extension with the auditor key → `BadMintConfig` |
| `wrap(amount)` | member (registry `active`) | `transfer_checked` mock → custody; `mint_to`; CPI Token-2022 `Deposit(amount)` (member signer propagates); `wrapped += amount`; emit `Wrapped{member}` (no amount) → `MemberInactive, AmountZero` |
| `unwrap(amount)` | member | burn from public balance (after a client-side confidential `Withdraw`); `transfer_checked` custody → member; `wrapped −= amount` → `InsufficientPublicBalance` |

Invariant test: `cstock_mint.supply == custody.amount == vault.wrapped`.

### 9.5 `window_credit`

| Account | Seeds | Fields |
|---|---|---|
| `Config` | `["config"]` | `admin`, `operator`, `keeper`, `oracle_program`, `auction_program`, `registry_program`, `cstock_mint`, `mock_mint`, `escrow_account`, `feed_id: [u8;32]`, `haircut_bps`, `max_price_age`, `tenor_slots`, `price_exp`, `mult_exp`, `multiplier_override: Option<u64>`, `bump` |
| `PriceCache` | `["price", feed_id]` | `feed_id`, `price`, `expo`, `publish_time`, `posted_slot`, `posts`, `bump` |
| `Loan` | `["loan", epoch_le, borrower, bid_tick, k]` | `lender`, `borrower`, `epoch`, `tick` (= r\*), `bid_tick`, `k`, `fill: (u64,u64)`, `size_ct: [u8;96]`, `collateral_ct: [u8;96]`, `delta_commitment: [u8;32]`, `k_c`, `k_l`, `price_at_lock`, `mult_at_lock`, `lock_slot`, `funded_slot`, `deadline_slot`, `status: {Pending, Requested, Deposited, Locked, Active, Repaid, Defaulted}`, `collateral_released`, `bump` |

| Instruction | Signer | Rules → errors |
|---|---|---|
| `initialize(params)` | admin | `haircut_bps ≥ 10000` → `BadParams` |
| `post_price(price, expo, publish_time)` | keeper | `price > 0`; `publish_time ≥ previous`; records `posted_slot` → `BadPrice, PriceRegressed` |
| `post_matches(epoch, matches: Vec<{borrower, lender, k, kind}>)` (≤ 3 per tx) | admin; per match `borrower_bid`, `lender_bid`, `loan (init)`, `[validity_ctx if Partial]` | `Print.Printed`; `borrower_bid.side == BID ∧ tick ≥ r*`; `lender_bid.side == ASK ∧ tick ≤ r*`; `Full ⇒ size_ct = borrower_bid.ciphertext`; `Partial ⇒` validity context binds (borrower key, auditor key); `loan.tick = r*`; `Pending` → `NotPrinted, WrongSide, TickNotFilled, BadPartialProof` |
| `lock_collateral` | borrower; remaining `[validity_ctx, range32_ctx, equality_ctx, range64_ctx]` (all context-state accounts; inline does not fit) | price fresh; multiplier from the mint's `ScaledUiAmountConfig` (or `multiplier_override`) → `a`; `k_c = p′·a`, `k_l = haircut/100`; scalar bound; validity keys; `range32.commitments[0] == validity.commitment`, `bit_lengths[0] == 32`; `E_Δ = k_c·E_c − k_l·E_ℓ`; `eq.pubkey == borrower key`, `eq.ciphertext == E_Δ`; `range64.commitments[0] == eq.commitment`, `bit_lengths[0] == 64`; close ×4; store `price_at_lock, mult_at_lock, k_c, k_l, collateral_ct, delta_commitment`; → `Requested`; emit `LockRequested{loan}` → `NotPending, PriceStale, ScalarBound, MultiplierInvalid, MemberKeyMismatch, AuditorKeyMismatch, CollateralRangeMismatch, DeltaMismatch, DeltaRangeMismatch, ContextAuthorityMismatch` |
| `deposit_collateral` | borrower; Instructions sysvar | the previous instruction in the transaction is a Token-2022 confidential `Transfer` from the borrower's cSTOCK-W account to `config.escrow_account` → `Deposited` → `NoEscrowTransfer, NotRequested` |
| `confirm_lock` | operator | `Deposited → Locked` → `NotDeposited` |
| `confirm_funding` | admin | `Locked → Active`; `deadline_slot = slot + tenor_slots` → `NotLocked` |
| `repay` | admin | `Active → Repaid` → `NotActive` |
| `seize` | anyone | `Active ∧ slot > deadline_slot ∧ price fresh → Defaulted` → `NotActive, NotMatured, PriceStale` |
| `release` / `seize_to` | operator (with the operator's confidential transfer in the same transaction, introspected) | `Repaid → released` / `Defaulted → seized`; `collateral_released = true` → `NotTerminal, AlreadyReleased` |

### 9.6 Mathematical crates (pure, independently testable)

- **`window-elgamal`** — typed Ristretto points, ciphertext layouts identical to `solana-zk-sdk`'s pod types (checked by tests), homomorphic `accumulate`, `residual`, `scale`, `sub`, `shifted_commitment`, `solvency_delta`; built on `solana-curve25519` so the identical function bodies run as dalek on the host and as syscalls on SBF. `std` feature adds wallet-derived keys, encryption, decryption-by-comparison and BSGS (`Solver::build(baby_bits)`, giant steps upward from zero).
- **`window-clearing`** — `#![no_std]`, allocation-free: `Tick`, `Side`, `DepthCurve`, `cumulative`, `clear`, `ask_allocation`, `bound_ok`, `regime::step`. Fixtures are hand-computed from §7.3 and a property test checks `clear` against a brute-force evaluation of the formula on random curves.
- **`window-proofs`** — `scalar` (units and bounds; compiled into `window_credit`), builders for bid proofs, PoCD proofs and the solvency pair (`builders` feature), instruction sequencing helpers, and a `verify` module that re-checks any print or loan from raw account data.
- **`window-proofs-wasm`** — `wasm-bindgen` façade of the builders and verifier for the dashboard.
- **`window-config`** — typed loader for `config/*.toml`.
- **`window-testkit`** — LiteSVM bootstrap (five programs + bundled Token-2022 + the ZK ElGamal builtin), confidential mints, members, a `ProofFactory` and a fluent `Scenario` builder.

### 9.7 Read-only lens

`@thewindow/solana-sdk` (TypeScript on `@solana/kit`; clients generated from the frozen IDLs with codama): `fetchEpoch`, `fetchDepth`, `fetchPrint`, `fetchLoans`, transaction builders (`buildBidTxs`, `buildLockTxs`, `buildWrapTxs`), `verifyPrint(epoch)` — downloads accumulators, claimed sums and the proof transactions and re-verifies every sigma proof client-side (wasm) — and `verifySolvency(loan)`. The explorer shows raw ciphertexts beside the proven curve with a green "re-verified locally" badge.

External programs: Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), ZK ElGamal Proof (`ZkE1Gama1Proof11111111111111111111111111111`), the Instructions sysvar (`Sysvar1nstructions1111111111111111111111111`).

---

## 10. Repository Structure

```
the-window-stocks/
├── Anchor.toml · Cargo.toml · rust-toolchain.toml · .cargo/ · rustfmt.toml · clippy.toml
├── package.json · pnpm-workspace.yaml · tsconfig.base.json · biome.json · Makefile
├── .github/workflows/ci.yml        # rust-fast, programs (anchor build + LiteSVM), ts, integration (real validator), docs
├── README.md · LICENSE · .env.example
├── programs/
│   ├── window_registry/  window_auction/  window_oracle/  window_wrap/  window_credit/
├── crates/
│   ├── window-elgamal/  window-clearing/  window-proofs/  window-proofs-wasm/  window-config/  window-testkit/
├── services/
│   ├── admin/                       # Rust: administrator + keeper + operator + price poster (one key, disclosed)
│   ├── agents/                      # TS: scripted members, labelled "simulated"
│   └── indexer/                     # TS: logs → SQLite → REST (/xonia, /depth, /loans, /verify/:epoch)
├── sdk/                             # @thewindow/solana-sdk: idl/ (frozen), generated/ (codama), wasm/
├── app/                             # dashboard: Vite + React, wallet-standard; home, explorer, borrow desk, positions
├── tests/                           # window-tests (LiteSVM): e2e/ attacks/ invariants/ privacy/ measurements/
│   └── integration/                 # vitest against solana-test-validator through the SDK, real services
├── scripts/                         # sync_idl, check_localnet, localnet, setup_*, deploy_devnet, watch_epoch, leak_audit, codegen, build_wasm, check_claims, check_lineage
├── config/                          # demo.toml · integration.toml · prod.toml
├── deployments/                     # localnet.json · devnet.json · program-keypairs/ (git-ignored)
└── docs/                            # SPEC.md · SPEC_V2.md (this) · SPEC_AMENDMENTS.md · BUILD_PLAN.md · toolchain.md · METHODOLOGY.md · THREAT_MODEL.md · DEMO.md · measurements.json · adr/
```

---

## 11. Risk / Control State

```rust
#[account(zero_copy)]
pub struct Epoch {
    pub index: u64,
    pub status: u8,                              // Open | Closed | Printed | NoTrade
    pub start_slot: u64,
    pub close_slot: u64,                         // 0 until closed
    pub auditor_pubkey: [u8; 32],                // key in force for this epoch's bids
    pub acc_commitment: [[[u8; 32]; 37]; 2],     // Ristretto points, side × tick
    pub acc_handle:     [[[u8; 32]; 37]; 2],     // auditor decrypt handles
    pub bid_count:      [[u32; 37]; 2],
    pub total_bids: u32,
}

#[account]
pub struct Bid {                                 // one per (epoch, member, side, tick)
    pub epoch: u64, pub member: Pubkey, pub side: u8, pub tick: u8,
    pub ciphertext: [u8; 96],                    // grouped (C, D_member, D_auditor) — never plaintext
    pub slot: u64,
}

#[account(zero_copy)]
pub struct Print {
    pub epoch: u64,
    pub status: u8,                              // Attesting | Missed | Printed | NoTrade
    pub claimed_sum: [[u64; 37]; 2],             // micro-USDC, proven per tick
    pub nonzero_bitmap: [u8; 10],                // from bid_count at begin_print
    pub proven_bitmap: [u8; 10],                 // must equal nonzero_bitmap at finalize
    pub attested: u8, pub missed: u8,
    pub r_star_tick: u8, pub matched_volume: u64,
    pub marginal_tick: u8, pub marginal_ratio_num: u64, pub marginal_ratio_den: u64,
    pub stale: u8, pub tau: u16, pub regime_flags: u8,
    pub finalized_slot: u64, pub matches_posted: u32,
}

#[account]
pub struct Loan {
    pub lender: Pubkey, pub borrower: Pubkey,
    pub epoch: u64, pub tick: u8, pub bid_tick: u8, pub k: u8,
    pub fill_num: u64, pub fill_den: u64,        // disclosed marginal ratio (1/1 for full fills)
    pub size_ct: [u8; 96],                       // never plaintext
    pub collateral_ct: [u8; 96],                 // never plaintext
    pub delta_commitment: [u8; 32],
    pub k_c: u64, pub k_l: u64,                  // public scalars used at lock
    pub price_at_lock: u64, pub mult_at_lock: u64,
    pub lock_slot: u64, pub funded_slot: u64, pub deadline_slot: u64,
    pub status: u8,                              // Pending|Requested|Deposited|Locked|Active|Repaid|Defaulted
    pub collateral_released: bool,
}

#[account]
pub struct PriceCache {
    pub feed_id: [u8; 32], pub price: u64, pub expo: i32,
    pub publish_time: i64, pub posted_slot: u64, pub posts: u64,
}
```

Regimes: `Open`, `Closed`, `Printed`, `NoTrade` for epochs; `Attesting`, `Missed`, `Printed`, `NoTrade` for prints; orthogonal flags `stale`, `BandEdge`; credit gate `price_fresh`. The rate is a pure function of the validated `claimed_sum` array; credit actions are pure functions of verified contexts plus a fresh public price. Nothing administrator-supplied is read except through the proof-checked path.

---

## 12. Required Security Properties

**Authentication and authorization**
- `Config` PDAs hold admin, keeper, operator, oracle/auction/registry program ids, mints, feed id and parameters; every gated instruction checks its signer.
- Members authenticate by registry PDA; a bid's grouped ciphertext must carry the member handle under the ElGamal pubkey in that PDA (checked via the validity context's public keys).
- `mark_printed` is callable only with the oracle program's `["authority"]` PDA as signer (a CPI caller cannot be identified through the Instructions sysvar, so a PDA signature is used instead).
- `PriceCache` is writable only by the keeper key; readers enforce `max_price_age` and matching `feed_id`.
- Every consumed proof context must be owned by the ZK ElGamal Proof program, be of the expected proof type, and have `context_state_authority == the transacting user`; it is closed by CPI in the same instruction (the user's signature propagates).

**Safety bounds**
- Claimed sums `≤ n_t·2^40`; bids range-proven; one bid per member/side/tick/epoch (enforced by the `Bid` account's `init`); `max_bids_per_epoch`.
- **Scalar bound** `k_c·2^32 < 2^63` and `k_l·2^40 < 2^63` asserted at configuration and re-checked at lock.
- **Wrap invariant:** `cSTOCK-W.supply == custody.amount == vault.wrapped`, invariant-tested.
- Compute budget per instruction measured and asserted; programs accept proofs only through verified contexts (inline via the Instructions sysvar, or context-state accounts), never unverified data.
- ZK ElGamal Proof program disabled by feature gate → no attestation can succeed → market degrades to stale, credit to inaction.

**Observation and finalization safety**
- *Uniqueness:* one `Print` per epoch; `finalize_print` is final; contexts closed at consumption.
- *Ordering:* `begin_print` requires `Closed`; `post_matches` requires `Printed`; `confirm_lock` requires `Deposited`; `confirm_funding` requires `Locked`; terminal loan states are final.
- *Maturity:* `seize` requires `slot > deadline_slot ∧ price fresh`; `close_epoch` requires the slot gate.
- *Binding:* each PoCD context's ciphertext is recomputed by the program from the specific epoch's frozen accumulator and claimed sum — a proof for another epoch/tick/sum cannot match; each solvency context binds to this loan's `E_Δ` under the current `PriceCache` and multiplier.

**Privacy — the leak budget, enforced by tests.**
*Never in plaintext on-chain, in logs, in the indexer or in service output:* bid size, loan size ℓ, collateral shares c, repayment amounts, any member's confidential balance.
*Public by design:* member pubkey, side, tick, timing (participation is not hidden — §14); per-tick aggregates after the print, r\*, matched volume, marginal ratio (the benchmark); `PriceCache`, `price_at_lock`, `mult_at_lock`, `k_c`, `k_l` (market scalars carrying no position information); loan existence and lifecycle (lender, borrower, epoch, tick, status, deadline); the wrap/unwrap public token legs (a Token-2022 confidential `Deposit` credits from a public balance).

| Layer | Rule | Test |
|---|---|---|
| Instruction interfaces | no instruction of the five programs takes a size; only `wrap/unwrap(amount)` (public leg) and `post_price` carry numbers | `tests/privacy/idl_surface.rs` — every numeric argument/field in the five IDLs must be on an explicit allow-list |
| Account state | sizes exist only as ciphertext byte arrays (`Bid.ciphertext`, `Loan.size_ct`, `Loan.collateral_ct`, `Loan.delta_commitment`) | same test |
| Events | no event carries an amount | same test, over `events` |
| Runtime, tier 1 | after a full epoch and two loans with known secret quantities, scan every program-owned account, every transaction's instruction data and every log for each secret as LE-u64, LE-u128 and ASCII decimal (and ×100, ÷10^6 variants); zero hits except the allow-listed wrap `Deposit` amounts | `tests/privacy/leak_audit.rs` (LiteSVM) |
| Runtime, tiers 2–3 | same scan through RPC against the real validator and, after the overnight run, against devnet | `tests/integration/desk.test.ts` ("leak audit" case, over RPC after the tier-2 lifecycle), `scripts/leak_audit.ts --cluster devnet` |
| Admin service | decrypted values live in a `Secret<u64>` newtype that prints `[redacted]`; tracing redaction layer; `/metrics` exposes aggregates only | `services/admin/src/secret.rs` (`Secret<T>` prints `[redacted]`; the value never implements `Display`) |
| Indexer | not built: the dashboard reads the chain directly (`app/src/lib/queries.ts`); there is no off-chain store to leak into | — |
| Dashboard | ciphertexts render through one `EncryptedValue` component; decryption happens only in the wallet owner's browser with the wallet-derived key | component test + honest-claims grep |

**Liveness**
- Keeper dead → anyone closes after grace; prices stop → credit halts safely, the auction continues.
- Administrator dead → prints stop, `stale` set by anyone via `mark_stale`, epochs cycle, late finalize allowed; auditor key rotatable via `rotate_auditor` (between epochs only) together with the mints' confidential-transfer config.
- Operator dead → locks stay `Deposited`; no funds at risk beyond the borrower's own balances.

**Upgrade and governance (hackathon)**
- Upgrade authority held by the single builder key during the build; **set to `None` (immutable) at the submission tag.** Versioned program ids; nothing merges after the freeze. Parameters immutable per deployment except auditor-key rotation.

---

## 13. Threat Model

| Threat | Required mitigation | Test |
|---|---|---|
| Administrator publishes a false per-tick sum to reshape the curve | `ZeroCiphertext` PoCD per nonzero tick, verified by the ZK program, bound to the frozen accumulator; identity check for zero ticks | attack 1 |
| Administrator publishes correct sums but a wrong r\* | on-chain recompute with `window-clearing`; mismatch rejects the print | attack 2 |
| Proof replayed from another epoch, tick or sum | the program recomputes the expected residual from frozen state; a tick can be attested once | attack 3 |
| Finalize with one nonzero tick's proof missing | `proven_bitmap` must equal `nonzero_bitmap` | attack 4 |
| Member submits a malformed or oversized ciphertext to break BSGS or poison an aggregate | validity + range proofs at submit; bound check at finalize | attack 5 |
| Undercollateralized borrow | priced solvency pair over `E_Δ`; a negative `Δ` cannot pass the U64 range proof | attack 6 |
| **Keeper posts a stale price to admit thin loans or force seizures** | `PriceCache` carries `feed_id`, `publish_time` and `posted_slot`; staleness bound at every credit action; `price_at_lock` recorded publicly per loan | attack 7 |
| **Rebase (stock split) used to fake or destroy solvency** | the multiplier sits in the public scalar, read from the mint's `ScaledUiAmount`; a 10:1 split leaves solvency verdicts unchanged | attack 8 |
| Borrower claims a collateral deposit that never happened | `deposit_collateral` verifies the preceding Token-2022 confidential `Transfer` to the escrow through the Instructions sysvar | lifecycle e2e |
| Wrap inflation (mint cSTOCK-W without collateral) | wrap is the only mint path; supply-vs-custody invariant; `transfer_checked` into a PDA-owned custody | invariants |
| Member dust-spams ticks | minimum size via the range proof on `(s − s_min)`; one bid per member/side/tick/epoch; `max_bids_per_epoch` | attack 5, unit |
| Keeper griefing (early/never close) | slot-gated close; permissionless after grace | unit |
| Front-running bids | ticks public, sizes hidden; uniform-price clearing removes intra-epoch ordering advantage; no plaintext to sandwich | design |
| Operator absconds with escrow | disclosed trusted surface; authority on-chain; custody in the operator's confidential account; release/seize are on-chain events | §14 |
| Lender under-funds a loan | administrator-attested funding in the MVP (§14); equality-proof enforcement is a §23 extension | §14 |
| Auditor key compromise | rotation via `rotate_auditor` + Token-2022 `UpdateMint`, **between epochs only**; `Epoch.auditor_pubkey` binds each epoch to its key | unit |
| ZK ElGamal Proof program disabled | prints halt safely; credit halts; documented platform dependency | design |
| Transaction-size / CU limits break a print | ≤ `attest_batch` proofs per transaction by design; identity shortcut trims the proof count; measured (§15) | measurements |
| Toolchain drift silently changes proof layouts | exact dependency pins; the gate test verifies the whole proof path on every CI run | CI |
| Sybil members | admin-gated admission; disclosed | — |

---

## 14. Honest Limitations

The project must not claim any of the following.

- **"Trustless" / "undecryptable."** The Benchmark Administrator holds the auditor key and can decrypt every individual bid, loan and balance. The claim is *accountable* privacy: the public sees aggregates, the price and the rate, and every published aggregate is proven.
- **Participation privacy.** Member keys, ticks and timing are public. Hiding *who* participates is a §23 extension, not a delivered property.
- **Wrap amounts are visible.** A Token-2022 confidential `Deposit` credits from a public balance, so the amount a member onboards appears in that transaction — like funding a brokerage account. The position (what is bid, borrowed and pledged) is never derivable from it; the dashboard guides members to wrap once, in round size, ahead of bidding.
- **Mock collateral.** Devnet cSTOCK-W wraps a mock xStock mint that mirrors the real assets' Token-2022 extension layout (`ScaledUiAmount`, metadata, permanent delegate). No real xStocks are touched; mainnet wrapping is roadmap. `PermanentDelegate` means the issuer can claw custody — true of real xStocks too.
- **Keeper-attested price.** The Pyth price enters via a keeper-posted cache attested against a named public 24/7 feed (feed id and publish time on-chain). An on-chain receiver read is roadmap unless the stretch lands. The multiplier is read from mock-mint state the team controls on devnet.
- **No intra-tenor margin calls.** Overnight tenor + 150% haircut + deadline seize only. The haircut is illustrative, not risk-calibrated.
- **Funding magnitude attested.** `confirm_funding` and `repay` are administrator attestations after decrypting the transfer's auditor ciphertext; the program enforces lifecycle finality, not transfer size.
- **Custody with the operator.** A PDA cannot generate confidential-transfer proofs, so escrow sits in the operator's confidential account. Authority on-chain; custody not.
- **One key.** Administrator, keeper, operator and price poster are one disclosed key in this deployment; the separation exists in program design, not operations.
- **Simulated members.** Auction depth comes from scripted bots operated by the team, labelled "simulated" everywhere; the judge-usable borrow flow is real but not organic demand.
- **Not a regulated benchmark; not a broker.** xONIA is a devnet reference rate; the SOFR/SONIA comparison is governance shape only. Nothing here is investment advice or a brokerage service.
- **Platform dependency.** The mechanism depends on the ZK ElGamal Proof program and curve25519 syscalls; if disabled, prints and credit stop. The `solana-curve25519` Rust wrapper is declared "unstable API" by its maintainers (the syscalls are activated protocol features).
- **Research deferred.** The behavioral experiment is not run for this submission (§15).
- **Unaudited. Single tenor. Do not custody real value.**

---

## 15. Research Experiment

**Baselines to compare against.** B1 — a transparent uniform-price auction (plaintext sizes); B2 — administrator-*attested* prints (no proofs); T — this build (proven prints). The behavioral arms B1/B2 are **deferred** to the post-hackathon phase and said so; this submission ships the verification core.

**Gate results (obtained before Phase 1, build machine, Anchor CLI 1.1.2, LiteSVM running Agave's program runtime and the real ZK ElGamal builtin):**

| Path | Result | Measured |
|---|---|---|
| Two grouped bids → syscall accumulation → auditor decrypt | `= Σ sizes` | — |
| PoCD (`ZeroCiphertext` on the residual), true sum / false sum | verifies / rejected, locally and on-chain | 192 B; 6,000 CU; 363 B tx |
| Four inline PoCDs in one transaction | verifies | 24,000 CU; 954 B |
| Bid validity (2 handles), inline | verifies | 320 B; 6,400 CU; 491 B tx |
| Bid range `[40, 24]` into a context-state account; then close | verifies; closed | 936 B; 111,000 CU; 1,141 B tx; close 3,300 CU |
| Solvency pair over `E_Δ` (c = 1,000.000 shares, p′ = 40,012, a = 1,000; ℓ = 200,000 USDC) | verifies on-chain; ℓ = 300,000 USDC cannot be proven | equality 320 B / 6,400 CU; range 936 B / 111,000 CU |
| **Anchor program on SBF** — `submit_bid`: introspected validity + context-account range + curve syscalls + CPI close | ✓ (×2 bids; context closed) | 27–30k CU; 676 B tx |
| **Anchor program on SBF** — `attest`: introspected PoCD bound to the accumulator | true ✓ / false ✗ | 16.7k CU; 480 B tx |

**Scenarios to run (attack tests, all must be rejected on-chain):**
1. Administrator submits a false per-tick sum → attestation rejected.
2. Correct sums, wrong r\* → finalize rejected.
3. Proof replayed from a previous epoch/tick/sum → attestation rejected.
4. Finalize with one nonzero tick's proof missing → rejected.
5. Oversized / malformed bid ciphertext (range proof on the wrong commitment, wrong bit length, wrong keys) → submit rejected.
6. Undercollateralized borrow (value < 150%) → lock rejected (proof unconstructible; a forged commitment fails equality).
7. Stale price at lock and at seize → both rejected.
8. 10:1 rebase replay → solvency verdicts unchanged; a naive-valuation reference shows −90% for contrast.

**Invariant tests (property-based over a LiteSVM scenario state machine):** collateral conservation; wrap supply == custody; deadline safety; no double terminal state; `matched ≤ min(S, D)` and bids fully filled; epoch monotonicity; the scalar bound holds for every configured asset.

**Privacy tests:** IDL-surface allow-list; on-chain/log leak audit (tier 1, tier 2, devnet).

**Metrics to collect (reported in the README, regressions included):**
- Print cost: transactions, bytes, CU and wall-clock from close → finalize at 1 / 10 / 37 / 74 nonzero ticks (target ≤ 16 tx and ≤ 60 s on devnet for typical occupancy; the ≤ 16 tx figure holds up to 42 nonzero ticks at batch 3 and is **reported as measured**).
- Per-instruction CU for `submit_bid`, `attest_ticks`, `finalize_print`, `lock_collateral`.
- Autonomy: fraction of epochs printed unattended during the overnight devnet run; verifiability: `verifyPrint` success rate (target 1.0).
- Leak audit: an attacker script attempting to recover any size or position from chain data across the run must fail.

**Hypotheses.** H1 — the composition verifies on-chain at bounded cost (**confirmed** in the gate). H2 — a print costs ≤ 16 transactions and ≤ 1.4M CU per proof-verification transaction at typical occupancy (to be measured on devnet). H3 — the priced solvency proof rejects every undercollateralized case and is invariant under rebase (attack tests 6 and 8). H4 — no plaintext size or position is recoverable from chain data (leak audit). Regressions against these targets are reported as such.

---

## 16. Development Roadmap

**Phase 0 — Freeze (done).** Mechanism frozen (`SPEC.md`); amendments A1–A9 written; dependency set audited (nothing yanked or deprecated) and **proven**: host spike, `anchor build` with the installed CLI, SBF execution with real proofs; workspace, CI, parameter profiles, `window-config`, `window-clearing` (fixtures + property tests) green.

**Phase 1 — Primitives + auction vertical slice.** `window-elgamal`; `window-proofs` (scalar, bid, PoCD, instruction helpers); `window_registry`; `window_auction` (`initialize`, `open_epoch`, `close_epoch`, `submit_bid`, `Bid`); `window_oracle` (`initialize`, `begin_print`, `attest_ticks`); `window-testkit`; **the gate as a permanent measurement test** driven through the real instructions; ADRs. *Gate:* `cargo test -p window-tests --test measurements gate_pocd` prints the CU table.

**Phase 2 — Print + attacks 1–5.** `finalize_print`, `mark_stale`, `OracleState`, CPI `mark_printed`, `close_bid`, `rotate_auditor`; the fluent `Scenario`; full-epoch e2e with five scripted members and ρ = 1; attack tests 1–5; indexer skeleton (so every later phase is observable); print-cost measurements. *Gate:* e2e and attacks green.

**Phase 3 — Wrap + priced credit.** Mock-xStock mint (`ScaledUiAmount`, metadata, permanent delegate) and confidential mints; `window_wrap`; `window-proofs` solvency + verify; `window_credit` (price cache, matches, lock, deposit, confirm, funding, repay, seize, release); loan lifecycle e2e; attack tests 6–8; invariants; privacy tests; solvency measurements. *Gate:* borrow→repay and borrow→seize green; attacks 6–8, invariants and privacy green.

**Phase 4 — Services + real validator + devnet.** `services/admin`; SDK core (codama clients, builders); `services/agents`; **tier-2 integration suite** on `solana-test-validator`; `make demo`; devnet deploy and one autonomous epoch. *Gate:* `make test-integration` green; `watch_epoch.ts --epochs 1` exits 0 on devnet; the market runs overnight unattended.

**Phase 5 — Lens + dashboard.** `window-proofs-wasm`; SDK `verifyPrint` / `verifySolvency`; indexer `/verify/:epoch`; dashboard (home, explorer with local re-verification badge, borrow desk, positions). *Gate:* a judge-shaped walkthrough completes on devnet from a clean wallet.

**Phase 6 — Freeze and submit.** Measurements into the README; `METHODOLOGY.md`, `THREAT_MODEL.md`; leak audit on devnet; upgrade authority → `None`; tag; 3-minute video; submit ≥ 4 h before the deadline. *Gate:* a clean clone reproduces one epoch with `make demo`.

---

## 17. Suggested Calendar (Tue 15 Sep → Fri 18 Sep 16:00 UTC)

| When (IST) | Phase | Checkpoint |
|---|---|---|
| **Tue 15, evening** | 0 (done) → 1 | Gate proven; skeleton and clearing green; `window-elgamal`, `window-proofs`, registry, auction and oracle vertical slice, testkit, permanent gate test |
| Wed 16, 09:00–21:00 | 2 | Full encrypted epoch prints on LiteSVM, ρ = 1; attack tests 1–5 green; indexer skeleton |
| Wed 16, 21:00–01:00 | 3 start | Mock mint, `window_wrap`, price cache scaffolded |
| Thu 17, 09:00–17:00 | 3 | Priced solvency green; lifecycle green; attack tests 6–8, invariants, privacy green |
| Thu 17, 17:00–00:00 | 4 | Tier-2 suite green on a real validator; **devnet deployed; autonomous epochs printing by midnight; overnight unattended run** |
| Fri 18, 08:00–13:00 | 5 | Dashboard + lens complete; judge walkthrough passes; overnight-run stats and leak audit captured |
| Fri 18, 13:00–19:00 | 6 | README + measurements; freeze (authority → None); video; **submit by 21:30 IST (16:00 UTC)** |
| Fri 18, 19:00–01:30 | buffer | 4-hour buffer to the 20:00 UTC hard deadline; nothing new merges |

If any phase slips ≥ 3 hours, apply the cut order in §22 immediately rather than compressing the buffer.

---

## 18. Recommended Team Split

Solo build. The two-developer code-review rule is replaced by three disciplines: (a) every gate is executed **from a clean clone** before the phase is called done; (b) attack tests are written *before* the code they attack; (c) nothing merges after the Phase-6 freeze. Order: gate → auction → oracle → **indexer skeleton early** (so every later phase is observable) → wrap + credit → admin service → real-validator suite → devnet → dashboard → measurements. The behavioral experiment is already dropped; **the attack tests, the privacy tests and the priced solvency proof are never dropped.**

---

## 19. Three-Minute Judge Demo Script

| Time | Screen | Words |
|---|---|---|
| 0:00–0:25 | explorer of a transparent lending tx | "This is what borrowing against your stocks on-chain looks like today: your position, your leverage, your liquidation level — public, forever, to everyone who trades against you. Your brokerage would never do this to you. It's why 95% of $684M in tokenized stocks never comes on-chain. In TradFi, margin lending works *because it's private*." |
| 0:25–0:50 | market home on devnet, epoch counting down | "This is the private version, live on devnet. Every two minutes, members bid to borrow or lend at a public rate with an *encrypted* size; the program sums the ciphertexts without decrypting anything, and the market prints xONIA — the first on-chain borrow rate for tokenized stocks. Nobody is driving it. That print just happened." |
| 0:50–1:35 | borrow desk, wallet connected | "Watch a real borrow. I wrap tokenized stock into a confidential balance, bid, and I'm matched at the rate just printed. Now the part that shouldn't be possible: the program proves my collateral covers 150% of the loan — shares times the public Pyth price times the corporate-action multiplier — without ever seeing the shares or the loan. The price is public. The position is not. USDC drawn. Nothing about my size ever touched the chain in plaintext — and there's a test in the repo that fails if it ever does." |
| 1:35–2:00 | explorer split-screen | "Left: what the chain sees — seventy-four Ristretto ciphertexts. Right: the depth curve and the rate. The administrator decrypted only aggregates and had to post one native zero-knowledge proof per tick; the oracle checked every proof and recomputed the rate itself. This badge? Your browser just re-verified every proof from raw account data." |
| 2:00–2:25 | split replay + attack txs | "The edge case that breaks every naive integration: a 10-for-1 split. Watch the naive valuation crater 90% — and watch our solvency check not blink, because the multiplier lives inside the proof. And here's the administrator trying to cheat — false sum, fake rate, replayed proof — every one rejected on-chain. Here are the transactions." |
| 2:25–3:00 | xONIA overnight time series → title card | "The market ran all night unattended — here's every print, every one re-verifiable. Built entirely from Solana's own confidential balances, proof program and syscalls. No circuits, no trusted setup. The administrator can decrypt — we say so, like the New York Fed sees every SOFR trade — but it cannot lie. The rate is public. The price is public. The position never was." |

---

## 20. Likely Judge Questions

**"Would real people actually use this?"** The demand shape already exists at scale: securities-based lending is a giant TradFi business *because* it is private, and on Solana 95% of tokenized-stock value sits undeployed while transparent lenders throttle LTVs and caps. This build is the missing shape — brokerage-grade privacy with proofs a brokerage can't offer. The demo's borrowers are disclosed simulations plus a judge-usable real flow; organic demand is the next phase, not a hackathon claim.

**"Why not just use Kamino?"** On Kamino your collateral, loan, health factor and liquidation level are public — that's the product surface this replaces. Kamino's own throttling (LTV caps, per-asset debt ceilings) is the incumbent's admission that transparent stock collateral is hard to underwrite at size.

**"The administrator can see everything. How is that private?"** Exactly as private as SOFR, whose administrator sees every repo trade. The difference: our administrator's every published number is proven per tick on-chain — it can see, but it cannot lie. Threshold decryption is the stated §23 extension, not a claim.

**"Is the privacy claim actually tested?"** Yes. No instruction takes a size and no event carries an amount (enforced by an IDL allow-list test), and a leak-audit test scans every account, transaction and log of a full epoch plus two loans for the plaintext of every secret quantity — on LiteSVM, on a real validator, and after the overnight devnet run.

**"What if the price keeper lies or goes stale?"** Every `PriceCache` entry names the public 24/7 Pyth feed and its publish time — anyone can compare. Staleness halts credit actions in both directions: a stale price can neither admit a loan nor seize one. On-chain receiver reads close the surface fully and are roadmap.

**"What about a stock split mid-loan?"** The rebasing multiplier is a public scalar *inside* the solvency proof, read from the mint's `ScaledUiAmount` extension, so valuation tracks the rebase by construction — the encrypted share count never changes. We demo exactly this: naive valuation shows −90%; the proof verdict is unchanged.

**"How do you know aggregates will decrypt? What about garbage bids?"** Every bid carries a validity proof and a range proof at submission; the program will not accumulate anything that isn't a well-formed encryption of a bounded value. Claimed sums are bounded by bid count × range at attestation.

**"How many transactions does a print cost?"** Measured and reported: `begin_print` + ⌈nonzero ticks / 3⌉ attestation transactions + `finalize_print`. Zero ticks need no proof, so thin epochs are cheap; a fully occupied book is the documented worst case. Regressions are printed in the README, not hidden.

**"Is the loan actually funded for the right amount?"** Attested in this build: the administrator decrypts the transfer's auditor ciphertext and attests; the program enforces lifecycle, not magnitude. §23's equality-proof extension closes it. The *existence* of the collateral deposit, by contrast, is program-verified.

**"Are these real xStocks?"** Devnet mocks mirroring the real Token-2022 extension layout, including the rebasing multiplier — stated in §14. Wrapping real mainnet xStocks is the first roadmap item and changes no program logic.

**"Why should anyone reference xONIA?"** Nobody should yet — it's a devnet rate from simulated members. The claim is narrower and demonstrated: the mechanism produces a borrow rate for tokenized equities that is reproducible from chain state and administrator-proof, at a measured cost.

**"Where is the trusted setup?"** There is none. Sigma proofs and range proofs in the ZK ElGamal Proof program are transparent.

**"What happens if the ZK program is paused again?"** Prints and credit halt safely; `stale` is reported; no funds move without proofs. Listed as a platform dependency.

**"Why is the wrap amount visible?"** Because Token-2022 confidential deposits credit from a public balance — the same way funding a brokerage account is visible to the bank. The position is what is private, and the dashboard tells members to wrap once in round size so the onboarding leg says nothing about later bids.

---

## 21. Competitive Positioning

Acknowledged related work: Token-2022 Confidential Balances (the substrate); Kamino-class transparent lending against xStocks (the incumbent whose throttling proves the problem); MPC/FHE confidential-DeFi stacks (general confidential compute — no auction, no proven benchmark, no priced solvency); IPOR/Treehouse (benchmarks from public inputs); uniform-price auction protocols (public bids); this team's earlier private-lending build on another chain (the mechanism's conceptual origin; no artefact reused). Within Stocklana's visible field, Credit & Yield and privacy are empty lanes.

**The differentiated claim, demonstrated through code and measurement:** *the first private credit market for tokenized stocks — encrypted positions valued against a public oracle inside the proof itself — printing the first on-chain borrow rate for tokenized equities, with every published number proven by Solana-native sigma proofs, no custom circuits, no trusted setup, and a test suite that fails if a position ever appears in plaintext.*

---

## 22. MVP Scope

**Must contain**
- Confidential wrapped mints (cUSDC-W loan leg; cSTOCK-W collateral leg wrapping a mock xStock with `ScaledUiAmount`, metadata and permanent delegate); one-click confidential-account onboarding.
- `window_registry`, `window_wrap`, `window_auction`, `window_oracle`, `window_credit` on devnet, **immutable at submission**.
- Range-proven, validity-proven encrypted bids stored as `Bid` accounts; homomorphic accumulation; slot-gated epochs.
- PoCD per nonzero tick via the ZK ElGamal Proof program (inline, batched); identity shortcut; on-chain r\* recompute; bounds; binding to frozen accumulators.
- **Priced solvency**: equality + range proof pair over `E_Δ = k_c·E_c − k_l·E_ℓ` with the corrected units, the scalar bound, `PriceCache` freshness at lock and seize, and rebase safety from the mint's multiplier.
- Two-step lock with program-verified deposit; attested funding and repay; price-fresh permissionless seize.
- One admin service (disclosed single key), scripted agents (labelled), indexer with `/xonia` and `/verify/:epoch`, SDK `verifyPrint` + `verifySolvency`.
- Dashboard: market home, explorer with local re-verification badge, borrow desk, positions.
- Attack tests 1–8, the invariant suite and the privacy suite green in CI; tier-2 integration suite on a real validator; measurements in the README.
- `METHODOLOGY.md` (leak budget, trusted surfaces), `THREAT_MODEL.md`, honest-limitations README verbatim from §14.

**Must not contain (non-goals)**
- Participation privacy or anonymous membership · threshold administrator · contract-enforced funding magnitude · intra-tenor margin calls or a liquidation engine · term tenors / a rate curve · variable haircuts · multi-asset collateral baskets · a secondary loan market · a governance token or fees · mainnet deployment or real value · automatic band recentering · any claim of "trustless" or "undecryptable" · the behavioral experiment (deferred, stated).

**Cut order under schedule pressure** (apply top-down; never touch the bottom row):
receiver-read stretch → `deposit_collateral` introspection (fall back to operator-attested lock) → unwrap flow → positions page → lender-side UI (agents carry ASKs) → auditor-rotation demo.
**Never cut:** the proof path · attack tests · privacy tests · priced solvency with the multiplier · autonomous devnet epochs · explorer re-verification · the judge-signable borrow flow · the honest-limitations README.

---

## 23. Post-Hackathon Extensions

- **Real xStocks wrapping (first).** Point `window_wrap` at mainnet xStocks mints; program logic unchanged; adds real-asset custody considerations and the audit gate below.
- **Contract-enforced funding magnitude.** The lender's confidential `Transfer` in the same transaction as `confirm_funding` plus a `CiphertextCiphertextEquality` proof between the transfer's auditor ciphertext (lo + 2^16·hi combined homomorphically) and the loan ciphertext. Closes the attested surface.
- **On-chain price reads.** `pyth-solana-receiver` consumption replaces the keeper cache; identical downstream math.
- **Intra-tenor risk.** Margin-call instruction (top-up against the same priced proof) and partial seize; haircuts calibrated per asset from recorded volatility.
- **Threshold administrator.** Split the auditor secret; partial decryptions with Chaum–Pedersen proofs combined before the existing PoCD. Ristretto ElGamal is threshold-friendly.
- **Anonymous membership.** Merkle-set membership with per-epoch nullifiers via the alt_bn128 syscalls; hides participation. The one extension that reintroduces circuits and a trusted setup, priced accordingly.
- **Term tenors and a curve.** Parallel books per tenor; xONIA 1D/7D.
- **Address-lookup tables for prints.** v0 transactions raise the attestation batch to five proofs per transaction.
- **Toolchain.** Move to the `solana-zk-sdk` 7/8 line and LiteSVM 0.16 (Agave 4.2 runtime) when Anchor moves to `solana-instruction 4`.
- **The research program.** The B1/B2/T behavioral experiment at accelerator scale with a written report.
- **Real USDC confidential extension** when available; drop the wrapper.
- **Mainnet** after an external audit of the programs and every proof-consumption path.

---

## 24. Project Submission Description

> **THE WINDOW for Stocks** is a private margin desk for tokenized equities on Solana, printing **xONIA** — the first on-chain overnight borrow rate for tokenized stocks. Holders wrap xStocks-style Token-2022 collateral into confidential balances and borrow USDC through a sealed-bid uniform-price auction: bids carry encrypted sizes, an on-chain program sums the ciphertexts without decrypting, and an accountable administrator holding the mint's auditor key must prove every published aggregate with Solana's native ZK ElGamal proofs — the oracle recomputes the clearing rate itself, so a valid proof with a wrong rate is rejected. Collateral solvency is proven homomorphically against the public 24/7 Pyth price with the corporate-action multiplier inside the check: a stock split can neither fake nor destroy coverage, and the position size never appears on-chain — a test suite fails if it ever does. No custom circuits, no trusted setup. The administrator can decrypt, and we say so; what it cannot do is lie. Live on devnet, printing autonomously, every print and every loan re-verifiable from account data. In TradFi, margin lending works because it is private; on a transparent chain it was impossible. Now it isn't. The rate is public. The price is public. The position never was.

---

## 25. Final Pitch

Owning tokenized stocks should be at least as good as a brokerage account — and today it isn't, because using them as collateral means undressing in public. Ninety-five percent of the asset class sits idle for exactly that reason. THE WINDOW for Stocks rebuilds the private margin desk in ciphertext on Solana's own primitives: encrypted positions, an on-chain sum, a priced solvency proof where the price is public and the position is not, an accountable administrator whose every decryption is proven, and a borrow rate — xONIA — that anyone can re-verify from chain state alone. We measured what it costs, we wrote down what we trust, we shipped the attacks that fail, and we shipped the test that fails if a position ever leaks. The rate is public. The price is public. The position never was.
