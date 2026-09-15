# Threat model

What THE WINDOW protects, against whom, and which test proves each mitigation. Spec references
are to `docs/SPEC_V2.md` §13 (threats) and §15 (tests). Tests live in `tests/` (tier 1, LiteSVM on
Agave's real runtime + real ZK ElGamal builtin) and `tests/integration/` (tier 2, `solana-test-validator`
through the TypeScript SDK with the real admin service).

## Actors and trust

| Actor | Sees | Can do | Trusted for |
|---|---|---|---|
| Public / other members | ciphertexts; member keys, sides, ticks, timing; proven per-tick aggregates, r\*, matched volume, marginal ratio; loan existence + lifecycle; wrap/unwrap public token legs; `PriceCache` | nothing privileged | — |
| Member | own sizes (wallet-derived key; never leaves the browser) | bid, lock, deposit | own honesty only — every claim is proven |
| Benchmark Administrator (one disclosed key: administrator + keeper + operator + price poster) | every bid, loan and balance (auditor key) | open/close epochs, print, post matches, confirm funding/repayment, post the price, release/seize collateral | **accountable, not blind**: every published aggregate carries a proof of correct decryption; the rate is recomputed on-chain; price posts are attributable to a named public feed |
| ZK ElGamal Proof program / curve25519 syscalls | — | verify proofs, curve arithmetic | platform dependency (SIMD-0153) |

Secrets: bid sizes, loan sizes ℓ, collateral shares c, confidential balances, Pedersen openings.
Never plaintext on-chain, in logs, in instruction data, in service output or in the dashboard's
network traffic. Public by design (the *leak budget*, spec §14): participation, ticks, timing, the
per-tick aggregates after the print (a member alone at a tick is therefore revealed by the
aggregate — inherent to any published depth curve), the marginal pro-rata ratio (copied into each
marginal-tick loan as `fill_num/fill_den`), `price_at_lock`/`mult_at_lock`/`k_c`/`k_l`, loan
lifecycle, and the wrap deposit amount (Token-2022 confidential deposits credit from a public balance).

## Threats and mitigations

| # | Threat | Mitigation (where in code) | Proven by |
|---|---|---|---|
| T1 | Administrator publishes a false per-tick sum to reshape the curve | `attest_ticks`: one `ZeroCiphertext` PoCD per nonzero tick over the residual `(C − v·G, D)` recomputed on-chain from the frozen accumulator (`window_oracle/instructions/attest_ticks.rs`); zero ticks must be the identity at `begin_print` | `attacks/attack_01_false_sum.rs` — a proof for the false sum is rejected by the ZK program; a true proof with a false claim fails residual binding |
| T2 | Correct sums, wrong r\* | `finalize_print` recomputes `window_clearing::clear` on the attested sums and rejects a mismatching claim | `attacks/attack_02_wrong_rate.rs` |
| T3 | Proof replayed from another epoch, tick or sum | residual recomputed from *this* epoch's accumulator; `proven_bitmap` marks each tick once | `attacks/attack_03_replay.rs` |
| T4 | Finalize with a nonzero tick unproven | `proven_bitmap == nonzero_bitmap` required | `attacks/attack_04_missing_proof.rs` |
| T5 | Malformed / oversized / dust / duplicate bids (BSGS blow-up, aggregate poisoning) | `submit_bid` consumes a 2-handle validity context (member key + epoch auditor key) and a range context over `C − s_min·G` with bit lengths `[40, 24]`; the `Bid` PDA `init` is the one-bid guard; `bound_ok(sum, n)` at attest | `attacks/attack_05_malformed_bid.rs` (5 cases) |
| T6 | Undercollateralized borrow | `lock_collateral`: collateral validity + 32-bit range, then equality of `E_Δ = k_c·E_c − k_l·E_ℓ` (computed on-chain with curve syscalls) to a commitment and a U64 range proof on it; a negative Δ wraps to ≈2^252 and cannot pass | `attacks/attack_06_undercollateralized.rs` (4 cases) |
| T7 | Stale or regressing price to admit thin loans or force seizures | `PriceCache{feed_id, price, expo, publish_time, posted_slot}`; `slot − posted_slot ≤ max_price_age` at lock and seize; `publish_time` monotone | `attacks/attack_07_stale_price.rs` |
| T8 | Rebase (split) used to fake or destroy solvency | multiplier read from the mint's `ScaledUiAmount` at lock/seize and folded into the public scalar `k_c = p′·a` | `attacks/attack_08_rebase_replay.rs` — a 10:1 split leaves the verdict unchanged; a stale multiplier cannot fake coverage |
| T9 | Borrower claims a deposit that never happened | `deposit_collateral` introspects the previous instruction: Token-2022 confidential `Transfer` from the borrower's cSTOCK-W account to `config.escrow_account` (`window_credit/src/zk.rs`) | `e2e/loan_lifecycle.rs`; tier 2 `desk.test.ts` |
| T10 | Wrap inflation | `wrap` is the only mint path (PDA mint authority), `transfer_checked` into PDA-owned custody; invariant `supply == custody == vault.wrapped` | `invariants` |
| T11 | Keeper griefing (never closes) | slot-gated `close_epoch`, permissionless after `keeper_grace_slots`; `mark_stale` by anyone raises τ | `window_auction` unit tests |
| T12 | Front-running / sandwiching bids | sizes are ciphertexts; uniform-price clearing; ticks public by design | design |
| T13 | Auditor key compromise | `rotate_auditor` only between epochs; `Epoch.auditor_pubkey` binds each epoch's bids | `window_auction` unit tests |
| T14 | Plaintext leak through any channel | no instruction takes a size; IDL allow-list of numeric fields; leak audit over accounts + transactions + logs | `privacy/idl_surface.rs`, `privacy/leak_audit.rs` (tier 1); `desk.test.ts` leak audit over RPC (tier 2) |
| T15 | Service logs a decrypted value | `Secret<u64>` newtype prints `[redacted]`; `/metrics` exposes only counters | `services/admin` unit tests |
| T16 | Transaction-size / CU limits break a print | ≤ `attest_batch` (4) inline proofs per transaction, measured at 1,182 B; range proofs go to context-state accounts | `measurements/print_cost.rs` |
| T17 | Toolchain drift changes proof transcripts silently (happened: zk-sdk 5.0) | exact pins; the gate test on Agave 4.2 runtime (LiteSVM 0.16); tier 2 on `solana-test-validator` 4.2.1 | `measurements/gate_pocd.rs`, `make test-integration` |

## Accepted risks (disclosed, spec §14)

- Operator custody of escrow (a PDA cannot produce confidential-transfer proofs).
- Funding and repayment magnitudes are administrator attestations.
- One operational key for all four roles on devnet.
- Keeper-posted price (attributable to a named 24/7 Pyth feed) rather than an on-chain receiver read.
- Sybil resistance is admin-gated admission.
- `PermanentDelegate` on the mock mint lets the issuer claw custody — true of real xStocks.
