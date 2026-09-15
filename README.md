# THE WINDOW for Stocks

**A private margin desk for tokenized stocks on Solana.**

Encrypted collateral and bids in Token-2022 Confidential Balances, homomorphically summed on-chain,
cleared by an accountable administrator whose decryption is proven on-chain every print. Collateral
solvency is proven against the public Pyth price — with the corporate-action multiplier inside the
proof — without ever revealing the position. The output is **xONIA**, the xStocks Overnight Index
Average: the first on-chain borrow rate for tokenized equities.

> The rate is public. The price is public. The position never was.

| | |
|---|---|
| Specification | [`docs/SPEC.md`](docs/SPEC.md) (frozen) · [`docs/SPEC_AMENDMENTS.md`](docs/SPEC_AMENDMENTS.md) (what changed while building, and why) |
| Build plan | [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) — phases, gates, verified toolchain |
| Status | Phases 0–5 built and green: five programs on SBF, tier-1 suites (e2e, 8 attack tests, invariants, privacy, measurements) on Agave 4.2 via LiteSVM, tier-2 lifecycle through the TS SDK on `solana-test-validator` with the real services, dashboard. Devnet deployment pending faucet funding (`docs/DEMO.md` §C). |
| Honest-claims rule | Never "trustless", "undecryptable", "nobody can see". The administrator **can** decrypt individual amounts. The public sees aggregates, the price, and the rate — each proven or publicly attributable. Enforced by `scripts/check_claims.sh` in CI. |

## Layout

```
programs/   window_registry · window_auction · window_oracle · window_wrap · window_credit   (Anchor 1.1.2)
crates/     window-elgamal · window-clearing · window-proofs · window-proofs-wasm · window-client · window-config · window-testkit
services/   admin (Rust: administrator + keeper + operator + price poster, the simulated agents, /deployment + /join for the dashboard)
sdk/        @thewindow/solana-sdk (TypeScript on @solana/kit 8; codama-generated clients; transaction plans; wasm proofs; print re-verification)
app/        dashboard (Vite 8 + React 19 + Tailwind 4; wallet-standard via @solana/react)
tests/      window-tests (LiteSVM: e2e, attacks, invariants, privacy, measurements) · integration (real validator, real services, TS SDK)
config/     demo.toml · integration.toml · prod.toml — the single source of market parameters
docs/       SPEC.md · SPEC_V2.md · SPEC_AMENDMENTS.md · BUILD_PLAN.md · toolchain.md · METHODOLOGY.md · THREAT_MODEL.md · DEMO.md · adr/
```

## Quickstart

```bash
# toolchain: rustc 1.98.1, solana-cli 4.2.1, anchor-cli 1.1.2, node 24, pnpm 10, wasm-pack — see docs/toolchain.md
make build              # anchor build + freeze IDLs into sdk/idl
pnpm install && ./scripts/build_wasm.sh && pnpm -r build   # SDK (codama clients + wasm proofs) and the dashboard
make test               # tier 1: crates + programs on LiteSVM (Agave's real runtime, in-process)
make test-integration   # tier 2: real solana-test-validator, real admin service + agents, driven through the TS SDK
make demo               # one full epoch on localnet with the DEMO profile
cd app && pnpm dev      # dashboard against localnet (docs/DEMO.md)
```

## Privacy, enforced

"The position never was" is a tested property, not a slogan. No instruction of the five programs
takes a size; sizes exist on-chain only as ciphertexts; no event carries an amount; and a leak-audit
test scans every account, every transaction and every log of a full epoch and two loans for the
plaintext of every secret quantity. The same audit runs over RPC against the real validator after the tier-2 lifecycle. The leak
budget — what *is* public and why — is in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) §6 and
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Measurements

Measured on Agave 4.2 (LiteSVM 0.16) by `cargo test -p window-tests --test measurements`; `attest_batch = 4`.

| Path | Transactions / size | Compute units |
|---|---|---|
| `submit_bid` (validity inline + range context) | 769 B / 1,141 B | 33,040 + 111,000 |
| `attest_ticks`, 2 inline PoCDs (gate) | 768 B | 27,169 |
| print, 1 nonzero tick | 3 tx · ≤ 561 B | 69,535 |
| print, 10 nonzero ticks | 5 tx · ≤ 1,182 B | 173,997 |
| print, 37 nonzero ticks | 12 tx · ≤ 1,182 B | 486,630 |
| print, 74 nonzero ticks (worst case) | 21 tx · ≤ 1,182 B | 917,924 |

## Amendments to the specification

The mechanism in `docs/SPEC.md` is frozen; §7 and §12 change only by written amendment. The
amendments A1–A10 (transaction-size-driven print batching, bid PDAs, corrected solvency units, how
Token-2022 confidential deposits actually work, escrow signer reality, loan ciphertext handles, the
`ScaledUiAmount` multiplier, zero-copy accounts, the fresh-build guarantee, and the zk-sdk 7 proof line) are recorded with
evidence in [`docs/SPEC_AMENDMENTS.md`](docs/SPEC_AMENDMENTS.md).

## Honest limitations

The project must not claim any of the following.

- **"Trustless" / "undecryptable."** The Benchmark Administrator holds the auditor key and can decrypt every individual bid, loan, and balance. The claim is *accountable* privacy: the public sees aggregates, the price, and the rate, and every published aggregate is proven.
- **Participation privacy.** Member keys, ticks, and timing are public. Hiding *who* participates is a post-hackathon extension, not a delivered property.
- **Mock collateral.** Devnet cSTOCK-W wraps a mock xStock mint that mirrors the real assets' Token-2022 extension layout (including the rebasing multiplier). No real xStocks are touched; mainnet wrapping of real xStocks is roadmap.
- **Keeper-attested price.** The Pyth price enters via a keeper-posted cache attested against a named public 24/7 feed (feed id and publish time on-chain for anyone to check). An on-chain receiver read is roadmap. The multiplier is read from mock-mint state the team controls on devnet.
- **No intra-tenor margin calls.** Overnight tenor + 150% haircut + deadline seize only. The haircut is illustrative, not risk-calibrated.
- **Funding magnitude attested.** `confirm_funding` and `repay` are administrator attestations after decrypting the transfer's auditor ciphertext; the program enforces lifecycle finality, not transfer size.
- **Custody with the operator.** A PDA cannot generate confidential-transfer proofs, so escrow sits in the operator's confidential account. Authority on-chain; custody not.
- **One key.** Administrator, keeper, operator, and price poster are one disclosed key in this deployment; the separation exists in program design, not operations.
- **Simulated members.** Auction depth comes from scripted bots operated by the team, labelled "simulated" everywhere; the judge-usable borrow flow is real but not organic demand.
- **Not a regulated benchmark; not a broker.** xONIA is a devnet reference rate; the SOFR/SONIA comparison is governance shape only. Nothing here is investment advice or a brokerage service.
- **Platform dependency.** The mechanism depends on the ZK ElGamal Proof program and curve25519 syscalls; if disabled, prints and credit stop.
- **Research deferred.** The behavioral experiment (bid shading under transparency vs. encryption) is not run for this submission.
- **Unaudited. Single tenor. Do not custody real value.**

## License

MIT — see [`LICENSE`](LICENSE).
