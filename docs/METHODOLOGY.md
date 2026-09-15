# xONIA methodology

xONIA (xStocks Overnight Index Average) is the clearing rate of a sealed-size, uniform-price
overnight lending auction on tokenized stock collateral, printed once per epoch by an accountable
administrator whose decryption is proven on-chain. This document is the benchmark statement.

## 1. Instrument

Overnight (one `tenor_slots` window) USDC loans collateralised by cSTOCK-W, a confidential wrapper
of a Token-2022 xStock mint (mock on devnet; same extension layout — `ScaledUiAmount`,
`MetadataPointer`, `PermanentDelegate`). Haircut 150 % (`haircut_bps = 15000`), priced against the
keeper-posted Pyth price with the corporate-action multiplier folded into the solvency scalar.

## 2. Rate grid

37 ticks: `bps(t) = 100 + 25·t`, t ∈ [0, 36] (1.00 % … 10.00 % annualised). A bid is `(side, tick,
size)`; only `side` and `tick` are public. Minimum size `s_min` (1 USDC) and maximum `2^40 µUSDC`
are enforced by the range proof on `(size − s_min)`.

## 3. Clearing (spec §7.3)

Per tick, the administrator publishes `v^ASK_t` and `v^BID_t` (sums of the encrypted sizes). With
`S(r) = Σ_{t≤r} v^ASK_t` and `D(r) = Σ_{t≥r} v^BID_t`:

```
r* = min { r : S(r) ≥ D(r) > 0 }        matched = D(r*)
```

Bids at ticks ≥ r\* are filled in full; asks strictly below r\* fill in full; asks at the marginal
tick fill pro-rata by `marginal_ratio = take / at_tick` (disclosed in the print and copied to each
marginal-tick loan). If no r\* exists the print is `NoTrade` and the regime state advances.

`crates/window-clearing` is the only implementation (no_std, compiled into `window_oracle`,
the services and — through shared fixtures — the SDK). Fixtures were authored from the definition
above and checked against a brute-force evaluation by proptest.

## 4. Regime (spec §7.5–7.6)

`OracleState` tracks `stale`, `tau` (missed prints), `consecutive_trades`, `edge_streak`,
`band_edge`. A print missed for `stale_after_slots` after close can be marked stale by anyone; a
late finalize is still accepted. Five consecutive band-edge prints raise `band_edge`.

## 5. Proof of correct decryption

Each nonzero tick's accumulator `(C, D)` is a twisted-ElGamal ciphertext under the epoch's auditor
key. The administrator publishes `v` and a `ZeroCiphertext` proof that `(C − v·G, D)` encrypts 0;
the ZK ElGamal Proof program verifies it, and `window_oracle` binds the verified context to the
residual it recomputes itself. Anyone can re-run the verifier on the raw accounts and the attest
transactions — `verifyPrint` in the SDK does exactly that (in wasm, in the browser: the Explorer's
"re-verified locally" badge).

## 6. Leak budget

Public by design: membership, side, tick, timing; per-tick aggregates after the print; r\*, matched
volume, marginal ratio; loan existence and lifecycle; `price_at_lock`, `mult_at_lock`, `k_c`, `k_l`;
the wrap/unwrap public token legs. A member alone at a tick is revealed by that tick's aggregate.
Never public: individual bid, loan and collateral sizes; confidential balances; openings. Enforced by
`tests/privacy` (tier 1) and the RPC leak audit in `tests/integration` (tier 2).

## 7. Governance

Parameters live in `config/<profile>.toml` and are written into program `Config` accounts at
initialisation. §7 and §12 of the spec change only by written amendment (`docs/SPEC_AMENDMENTS.md`).
The administrator is a single disclosed key on devnet. xONIA is a devnet reference rate, not a
regulated benchmark.
