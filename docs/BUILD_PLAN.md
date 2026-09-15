# THE WINDOW for Stocks — from spec to a production-grade codebase

## Context

`/Users/apple/Desktop/Blinds/` contains exactly one file: `readme.md`, a 25-section build
specification for **THE WINDOW for Stocks** (Stocklana hackathon, deadline Fri 18 Sep 2026 20:00 UTC).
There is no code, no git repo, no toolchain config. The user wants the spec turned into a scalable,
industry-standard, high-quality codebase. The spec freezes the *mechanism*; this plan designs the
*engineering* — workspace, crates, programs, services, tests, tooling — so it can be executed in the
spec's phase order with a green gate at every step.

**User decisions (confirmed):** full monorepo built in phases; in place at `Blinds/` with `git init`;
include a wasm crate for browser-side proof generation.

### Dependency audit — nothing deprecated, and the stack was compiled and run (2026-09-15)

**Rust crates (crates.io API, yanked/latest checked for every pin):** none of the pinned versions is yanked.
The pinned set is exactly what `anchor-spl 1.2.0` itself carries (`spl-token-2022-interface ^2` → `proof-extraction 0.5` →
`solana-zk-sdk 4.0.0`), so it is coherent by construction. The newer line (`solana-zk-sdk 7/8`, `proof-extraction 0.6.1`,
`spl-token-2022-interface 3.1.1`, `solana-zk-elgamal-proof-interface`) moved to `solana-address`/`solana-instruction 4` and
**cannot yet be combined with Anchor 1.2** — it is the *next* Anchor's world, not deprecated but not usable here. Re-evaluate at Anchor 2.0.

**Compiled and executed spike** (`/private/tmp/claude-501/-Users-apple-Desktop-Blinds/1fa13459-45f3-46b6-89b6-8a14ec28a4b0/scratchpad/zk-spike`,
seed for `tests/measurements/gate_pocd.rs` and `crates/window-proofs`): `anchor-lang 1.2.0` + `solana-zk-sdk 4.0.0` +
`solana-curve25519 3.1.14` + `proof-extraction/generation 0.5.1` + `spl-token-2022-interface 2.1.0` + `litesvm 0.10.0`, on Rust 1.90.
Both tests pass against the **real ZK ElGamal Proof program** inside LiteSVM:

| Path | Result | Measured |
|---|---|---|
| 2 grouped bids → accumulate via `add_ristretto` → auditor `decrypt_u32` | = 1,250,000,000 ✓ | — |
| PoCD (`ZeroCiphertext` on residual) true sum / false sum | verifies / rejected, locally and on-chain ✓ | 192 B; 6,000 CU; 363 B tx |
| 4 inline PoCDs in one tx | ✓ | 24,000 CU; **954 B** with 1 account key |
| Bid validity (2 handles) inline | ✓ | 320 B; 6,400 CU; 491 B tx |
| Bid range `[40,24]` → context-state account (create, verify, close) | ✓ | 936 B; 111,000 CU; 1,141 B tx; close 3,300 CU |
| Solvency: `E_Δ = k_c·E_c − k_l·E_ℓ` via syscall-shaped ops, equality + U64 range (A3 units: c=1,000.000 sh, p′=40012, a=1000, ℓ=200,000 USDC) | verifies on-chain ✓; ℓ=300,000 USDC → prover cannot construct ✓ | equality 320 B/6,400 CU; range64 936 B/111,000 CU |

Consequence for A1: `attest_ticks` = 4 PoCDs (954 B) + its own ix and ~6 account keys ≈ 1,200 B — borderline. **Default batch = 3**,
raise to 4 only if the measured tx stays < 1,232 B; v0 + address-lookup-table is the path to 5.

**On-chain build proof** (`scratchpad/anchor-spike`, built with the *installed* `anchor-cli 1.1.2` + platform-tools, `anchor-lang =1.1.2`,
`solana-zk-sdk =4.0.0`, `solana-curve25519 =3.1.14`, `proof-extraction =0.5.1`): `anchor build` → `window_spike.so` (170 KB) + IDL.
The program was then **executed on SBF inside LiteSVM** with real proofs (`zk-spike/tests/program.rs`):

| On-chain path (as the real programs will do it) | Result | Measured |
|---|---|---|
| `submit_bid`: validity ctx via same-tx introspection (`verify_and_extract_context`, offset −1) + range ctx from a context-state account (offset 0, authority checked via `ProofContextStateMeta`) + `C − s_min·G` check + accumulation via curve syscalls + CPI `CloseContextState` with the member's propagated signature | ✓ ×2 bids; context account closed | 27–30k CU; **676 B** tx |
| `attest`: PoCD via introspection, residual recomputed on-chain from the accumulator, bound check | true sum ✓; false sum rejected | 16.7k CU; **480 B** tx |
| Auditor decrypts the on-chain accumulator | = Σ sizes ✓ | — |

Anchor 1.x API notes learned here (avoid re-discovery): `Context<'info, T<'info>>` has a single lifetime; the Instructions sysvar
is `UncheckedAccount` + `#[account(address = solana_instructions_sysvar::ID)]` (it is not an Anchor `Sysvar<T>`).

**Pin decision:** `anchor-lang = "=1.1.2"` / `anchor-spl = "=1.1.2"` to match the installed CLI (SBF-verified). `avm install 1.2.0`
is an optional Phase-0 upgrade (same crate family; host-verified) — do it only together with `rustup update`, and re-run the gate.

**Host toolchain note:** `rustc 1.90.0` (2025-09); current stable is **1.98.1**. Everything above builds on 1.90 today with
`litesvm 0.10.0`. The agave **4.x** runtime crates that LiteSVM ≥ 0.14 pulls (`solana-syscalls 4.2.2`) need Rust ≥ 1.97
(`maybe_uninit_write_slice`) → only if `rustup update stable` is run can `litesvm 0.16.0` (agave 4.2.2 = devnet's runtime) be used;
its dependency graph with this pin set was verified to resolve. `litesvm 0.13` is unusable (`solana-instruction =3.2.0` pin conflict).

**TypeScript (npm, all checked for `deprecated` flags — none set):** `@solana/web3.js` 1.99 is officially the *maintenance branch*
("successor: `@solana/kit`") and `@coral-xyz/anchor` 0.32 has not moved since Oct 2025; the Anchor 1.x client `@anchor-lang/core 1.2.0`
still depends on web3.js v1. So the SDK/app use the current stack (the one Bourse's SDK already uses):
`@solana/kit 8.3`, `@solana-program/token-2022 0.17` (has `getConfidentialDepositInstruction`, `getApplyConfidentialPendingBalance…`,
`getConfidentialWithdraw/TransferInstruction`, `getInitializeScaledUiAmountMintInstruction`, `getUpdateMultiplierScaledUiMintInstruction`,
metadata pointer, permanent delegate — verified in the tarball), `@solana-program/system 0.14`, `@solana-program/compute-budget 0.18`,
clients **generated from the Anchor IDL with codama** (`codama 1.11`, `@codama/nodes-from-anchor 1.5.6`, `@codama/renderers-js 2.5`),
wallets via wallet-standard (`@solana/react 8.3`, `@wallet-standard/react 1.0.3`). App/tooling: vite 8, react 19, tailwind 4,
`@tanstack/react-query 5`, recharts 3, vitest 5, tsup 8, biome 2.5, fastify 5, zod 4, pino 10, better-sqlite3 13, wasm-pack 0.15.

### Verified facts that shape the design (this machine, 2026-09-15)

| Fact | Consequence |
|---|---|
| anchor-cli **1.1.2** installed (avm has 1.2.0), solana-cli **4.2.1**, platform-tools 1.89-sbpf, node 24, pnpm 10.12, spl-token-cli 5.6.1 (has CT subcommands and `--ui-amount-multiplier`) | Pin Anchor **=1.1.2** (SBF build + execution verified); 1.2.0 optional later. |
| `anchor-lang 1.2.0`, `solana-zk-sdk 4.0.0`, `solana-curve25519 3.1.14`, `spl-token-2022-interface 2.1.0`, `spl-token-confidential-transfer-proof-{extraction,generation} 0.5.1`, `litesvm 0.10.0/0.16.0` all sit on the `solana-*` **3.x** crate family | Compatible set (compiled + run). Do **not** take `solana-zk-sdk 7/8`, `proof-extraction 0.6`, `anchor 2.0.0-rc`, `solana-program 5`. |
| ZK ElGamal Proof program (SIMD-0153, feature `zkhiy5oLowR7HY4zogXjCjeMXyruLqBwSWH21qcFtnv`) **active on devnet (epoch 801) and mainnet**; curve25519 syscalls active; `enable_zk_proof_from_account` inactive | Spec §16 Phase-1 gate is green on-chain. Proofs go in instruction data. |
| LiteSVM 0.10.0 `FeatureSet::all_enabled()+with_builtins()` loads the ZK ElGamal builtin and bundles `spl_token_2022-10.0.0.so`; `warp_to_slot` | In-process test substrate for everything incl. proofs and slot gates (house style of `/Users/apple/Desktop/Bourse`). |
| ZK program CU costs are fixed: ZeroCiphertext 6k, CiphertextCommitmentEquality 6.4k, Validity2 6.4k, BatchedRangeU64 111k, Close 3.3k | Print cost is dominated by tx count, not CU. |
| Tx limit 1232 B: `ZeroCiphertextProofData` 192 B; `GroupedCiphertext2HandlesValidityProofData` ≈ 320 B; `BatchedRangeProofU64Data` ≈ 936 B | PoCD proofs inline (≤4/tx via Instructions sysvar); range proofs must be verified into **context-state accounts** in their own tx; `finalize_print(74 contexts)` is impossible in one tx → print is split (see amendments). |
| `spl_token_confidential_transfer_proof_extraction::instruction::verify_and_extract_context::<T,U>(iter, offset, sysvar)` reads a context from a context-state account (offset 0) or a same-tx proof ix (offset ≠ 0). It checks owner + proof type only — **not** `context_state_authority`; `CloseContextState` needs the authority as **signer** | Programs check authority == member/borrower themselves and close via CPI with the user's signature propagating. |
| `solana-curve25519` compiles to dalek on host and syscalls on SBF with one API | One implementation of accumulation/residual/solvency math runs on both sides. |
| `DiscreteLog::decode_u32` (zk-sdk) covers 32 bits only; spec needs BSGS over ≈2^44 | `window-elgamal` ships its own BSGS. |
| `anchor-spl 1.1.2` `confidential_transfer` module is empty | CT CPIs are built by hand from `spl-token-2022-interface`. |
| Instructions sysvar sees only top-level ixs | `mark_printed` cannot verify a CPI caller via sysvar → oracle signs the CPI with a PDA. |
| The user's earlier Avalanche project exists on this machine (`/Users/apple/Desktop/The Window/`) | **Not used.** This is a fresh, independent build: no code, fixtures, tests, service loops, or docs are copied from it (amendment A9). The spec (`docs/SPEC.md`) and the Solana crates are the only inputs. `/Users/apple/Desktop/Bourse` is referenced for repository *conventions* only (Anchor/LiteSVM/pnpm layout), never for code. |

---

## Spec amendments (recorded in README "Amendments" section; §7/§12 change only by written amendment)

| # | Spec text | Amendment | Why |
|---|---|---|---|
| A1 | §7.2/§9 `finalize_print(epoch, claimed_sums[74], r*)` consumes 0–74 contexts; "contexts consumed and closed at finalize" | `begin_print` → `attest_ticks(≤4 claims + 4 inline VerifyZeroCiphertext ixs per tx)` → `finalize_print`. Binding via `Print.proven_bitmap`; nothing to close. Worst case 74 nonzero ticks = 21 tx; ≤16 tx holds for ≤56 nonzero ticks; **report measured**. | tx size |
| A2 | §11 `Epoch.fills: Pubkey` per-member fill map closed at print | `Bid` PDA `["bid", epoch, member, side, tick]` storing the 96-B grouped ciphertext; its `init` is the one-bid guard; rent reclaimed by permissionless `close_bid` after settlement. | Print tx can't enumerate/close per-member maps; `post_matches` needs individual bid ciphertexts from chain state, not RPC history. |
| A3 | §7.3 units: c < 2^40 shares, bound `100·p·a·2^40 < 2^63` | c in **milli-shares < 2^32**, ℓ in µUSDC < 2^40, p′ = price in cents (`price·10^(expo+2)`), a = multiplier·10^3; check `c·p′·a ≥ 150·ℓ` ⇒ `k_c = p′·a`, `k_l = 150` (spec's `(100·p·a, 150·b)` with b=100, ÷gcd). Bound: `k_c·2^32 < 2^63` and `k_l·2^40 < 2^63`. Negative Δ wraps to ≈2^252 → U64 range proof rejects. | Spec bound forces `100·p·a < 2^23` — unsatisfiable for any real price. |
| A4 | §7.1 wrap "mints into the member's confidential pending balance; member applies it with the standard native proof" | `wrap` = `transfer_checked` mock→custody, `mint_to` public balance, CPI CT `Deposit` (owner-signed, **no proof**). Client runs `ApplyPendingBalance` (no ZK proof, AE-encrypted balance only). | How Token-2022 CT actually works. |
| A5 | §8 "operator ──confidential transfer to escrow──▶ confirm_lock" | Borrower transfers to the operator escrow account (only the source owner can sign a CT transfer). Hardening: borrower sends `[CT Transfer, deposit_collateral]` in one tx; `deposit_collateral` introspects ix[−1] (Token-2022 CT `Transfer`, source = borrower cSTOCK-W ATA, dest = `config.escrow_account`) → `Deposited`; operator `confirm_lock` → `Locked`. Amount remains attested (§14); existence becomes program-verified. | Signer reality; cheap trust reduction. |
| A6 | §11 `Loan.size_ct: GroupedCiphertext` (unspecified) | 2-handle (borrower, auditor). `MatchKind::Full` copies `Bid.ciphertext` (program-enforced); `MatchKind::Partial{size_ct, validity_ctx}` for a bid split across lenders. At r\*, `matched = D(r*)` so **bids are always fully filled; only marginal asks are pro-rated**. | Simplest sound design; lender is told ℓ by the admin (disclosed surface). |
| A7 | §7.1 "multiplier from mint metadata"; `mult_at_lock` from Config | Mock mint carries Token-2022 **`ScaledUiAmount`**; `lock_collateral`/`seize` read the effective multiplier from the mint (`ScaledUiAmountConfig`) and scale it with `scalar::multiplier_scaled`. Admin `set_multiplier_override` kept only as fallback if f64 on SBF misbehaves in the gate. | That is the real rebasing mechanism. |
| A8 | §11 `Print.r_star_tick: Option<u8>` | Zero-copy `Print`/`Epoch`; `Option` is not Pod → `outcome: u8` enum + `r_star_tick: u8`. Add `Epoch.auditor_pubkey` stamped at `open_epoch` (§12 rotation between epochs). | Zero-copy for 5 KB accounts. |
| A9 | §9 "ported from the Avalanche `computeClearing` with identical fixtures", §10 "Avalanche fixtures included", §16 Phase 0 "Avalanche fixtures copied in" | **Fresh build.** Clearing implemented from the §7.3 formula with self-authored fixtures + brute-force proptest; no code, fixtures, tests, services, or docs from the prior project; CI lineage check. | User decision: an independent Solana-native product. |

---

## "The position never was" — privacy enforced in code, not prose

The tagline is a checkable property. Define the **leak budget** precisely and make the test suite fail whenever it is exceeded.

**Never in plaintext anywhere on-chain, in logs, in the indexer, or in service output:** bid size, loan size ℓ, collateral shares c,
repayment amounts, any member's confidential balance. **Public by design (and why):** member pubkey, side, tick, timing
(spec §14 — participation is not hidden); per-tick *aggregates* after the print, r\*, matched volume, marginal pro-rata ratio (the
benchmark); `PriceCache`, `price_at_lock`, `mult_at_lock`, `k_c`, `k_l` (public market scalars carrying no position information);
loan existence and lifecycle (lender, borrower, epoch, tick, status, deadline); the **wrap/unwrap public token legs** — a Token-2022
confidential `Deposit` credits from a public balance, so the amount a member *onboards* is visible in that transaction (inherent to
Token-2022 CT; identical to funding a brokerage account). The position — what is bid, borrowed, and pledged — is never derivable from it.

Enforcement, layer by layer:

| Layer | Rule | Test that fails otherwise |
|---|---|---|
| Instruction interfaces | No instruction of the five programs takes a size: `submit_bid(side, tick)`, `post_matches(…, kind)`, `lock_collateral()`, `confirm_funding()`, `repay()`. The only numeric args are `wrap/unwrap(amount)` (public leg) and `post_price(price, expo, publish_time)`. | `tests/privacy/idl_surface.rs`: parses the five IDLs; every `u64/u32/u128` arg or account field must be in an explicit allowlist (`amount` on wrap/unwrap, price fields, slots, counts, scalars, `claimed_sum` in `attest_ticks` — aggregate, proven). |
| Account state | Sizes exist only as ciphertext bytes: `Bid.ciphertext[96]`, `Loan.size_ct[96]`, `Loan.collateral_ct[96]`, `Loan.delta_commitment[32]`; `Epoch` holds accumulators, `Print` holds proven aggregates. | same IDL test (field names `*_ct`/`ciphertext`/`commitment` must be byte arrays) |
| Events | No event carries an amount: `BidSubmitted{epoch, member, side, tick}`, `Wrapped{member}`, `LockRequested{loan}`, `Printed{epoch, r_star, matched}` (aggregate). | IDL test over `events` |
| Runtime (Tier 1) | After a full epoch + two loans with known secret quantities, scan **every** program-owned account, **every** transaction's instruction data, and **all** program logs for each secret as LE-u64, LE-u128, and ASCII decimal (plus ×100, ÷10^6 variants). Expect zero hits; the wrap `Deposit` amounts are the only allowlisted matches. | `tests/privacy/leak_audit.rs` (LiteSVM, transaction history enabled) |
| Runtime (Tier 2 / devnet) | Same scan through RPC (`getSignaturesForAddress` → `getTransaction`, `getProgramAccounts`) against the real validator and, after the overnight run, against devnet (spec §15 "attacker script"). | `tests/integration/leak_audit.test.ts`; `scripts/leak_audit.ts --cluster devnet` in `docs/measurements.json` |
| Admin service | `tracing` redaction layer; decrypted values live in a `Secret<u64>` newtype whose `Debug`/`Display` print `[redacted]`; `/metrics` exposes only aggregates. | `services/admin/tests/redaction.rs` runs a full print with a capturing subscriber and asserts no secret appears |
| Indexer | Schema has no column for bid/loan/collateral size — only ciphertexts, proven aggregates, statuses. | `services/indexer/test/schema.test.ts` |
| Dashboard | Ciphertexts render through one `EncryptedValue` component; decryption happens only in the wallet owner's browser with the wallet-derived key, never sent anywhere. Honest-claims grep. | `app/src/lib/honestClaims.test.ts`, `EncryptedValue.test.tsx` |

Consequences for the design above: `Wrapped`/`Unwrapped` events carry **no amount**; `BorrowDesk` guides members to wrap once in a
round size ahead of bidding (so the onboarding leg reveals nothing about later positions); `post_matches` `Partial` fills carry a fresh
ciphertext + validity proof, never a number; the `fill: Ratio` on a loan is the *disclosed* marginal pro-rata ratio (spec §7.3), the
same for every loan at the marginal tick, so it reveals no individual size.

---

## Repository layout (in place at `/Users/apple/Desktop/Blinds/`)

```
Blinds/
├── Anchor.toml               # anchor_version 1.1.2; skip_local_validator = true; [scripts] test = "cargo test"
├── Cargo.toml                # workspace: programs/*, crates/*, services/admin, tests; pinned deps; overflow-checks=true
├── rust-toolchain.toml       # host stable (1.90 works today; 1.98.1 after `rustup update` unlocks litesvm 0.16); SBF uses platform-tools' rustc
├── .cargo/config.toml  rustfmt.toml  clippy.toml
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  biome.json
├── Makefile                  # build / test / lint / demo / deploy-devnet / freeze
├── .github/workflows/ci.yml  .editorconfig  .gitignore  .env.example  LICENSE
├── README.md                 # product, quickstart, measurements table (generated), §14 limitations verbatim, Amendments
├── docs/  SPEC.md (readme.md moved verbatim)  METHODOLOGY.md  THREAT_MODEL.md  DEMO.md  toolchain.md  measurements.json  adr/
├── config/  demo.toml  prod.toml            # §7.5 parameter table + A3 units — single source of truth
├── deployments/  localnet.json  devnet.json # program ids, mints, feed id, auditor pubkey
├── programs/  window_registry  window_auction  window_oracle  window_wrap  window_credit
├── crates/    window-elgamal  window-clearing  window-proofs  window-proofs-wasm  window-config  window-testkit
├── services/  admin (Rust)  indexer (TS)  agents (TS)
├── sdk/       @thewindow/solana-sdk (TS on @solana/kit; tsup ESM+CJS; idl/ frozen; generated/ from codama; wasm/ built)
├── app/       Vite 8 + React 19 + TS + Tailwind 4 + wallet-standard (@solana/react) + TanStack Query 5
├── scripts/   sync_idl.sh  check_localnet.sh  demo.sh  mints.ts  setup_localnet.ts  setup_devnet.ts  deploy_devnet.sh  watch_epoch.ts  leak_audit.ts  build_wasm.sh  measurements_to_md.mjs
└── tests/     window-tests crate (autotests=false): e2e/  attacks/  invariants/  measurements/
```

Root `Cargo.toml` follows Bourse's commented style (`/Users/apple/Desktop/Bourse/Cargo.toml`); each program
`Cargo.toml` follows `/Users/apple/Desktop/Bourse/programs/bourse_market/Cargo.toml` (features `cpi`,
`no-entrypoint`, `idl-build`; `[lints.rust] unexpected_cfgs`). `scripts/sync_idl.sh` copies
`/Users/apple/Desktop/Bourse/scripts/sync_idl.sh` (`--check` mode is a CI drift gate).

---

## Crates — shared contracts (one implementation for SBF, host and wasm)

| crate | SBF | host | wasm | features |
|---|---|---|---|---|
| `window-elgamal` | yes (`default-features=false`) | yes | yes | `std` (keys/encrypt/decrypt/bsgs via `solana-zk-sdk`, `curve25519-dalek`), `rayon` |
| `window-clearing` | yes (`#![no_std]`, no alloc) | yes | yes | `std` adds serde for fixtures |
| `window-proofs` | `scalar` module only (`default-features=false`) | yes | yes (`wasm`, `getrandom/js`) | `builders` (default), `verify` |
| `window-proofs-wasm` | — | — | yes | wasm-bindgen façade |
| `window-config` | — | yes | — | loads `config/*.toml` |
| `window-testkit` | — | dev-only | — | LiteSVM bootstrap |

**`window-elgamal`** (`src/{point,ciphertext,solvency,keys,encrypt,decrypt,bsgs}.rs`; core built on `solana_curve25519::ristretto`):
```rust
#[repr(transparent)] pub struct Point(pub [u8;32]);          // Pod; compressed Ristretto
#[repr(C)] pub struct Ciphertext { commitment: Point, handle: Point }              // 64 B == PodElGamalCiphertext
#[repr(C)] pub struct GroupedCiphertext2 { commitment: Point, handles: [Point;2] } // 96 B == PodGroupedElGamalCiphertext2Handles
pub type Accumulator = Ciphertext;  // identity pair == never accumulated
pub fn point_add/point_sub/point_mul/point_validate/is_identity;
impl Ciphertext { const ZERO; fn is_zero; fn accumulate(&self, &GroupedCiphertext2, handle_index) ; fn residual(&self, claimed_sum:u64) /* (C−v·G, D) */; fn scale(k:u64); fn sub(&Self); }
pub fn shifted_commitment(c:&Point, s_min:u64) -> Point;                     // C − s_min·G
pub fn solvency_delta(coll:&Ciphertext, k_c:u64, loan:&Ciphertext, k_l:u64) -> Ciphertext;  // E_Δ — the only place this formula exists
// std:
pub mod keys   { Keypair; from_signature([u8;64]); from_seed; DERIVATION_MESSAGE }   // wallet-derived, SDK uses same message
pub mod encrypt{ grouped2(member_pk, auditor_pk, amount) -> (GroupedCiphertext2, Opening); commit; commit_random_zero() /* range padding */ }
pub mod decrypt{ to_point; equals(kp, ct, expected) }
pub mod bsgs   { Solver::build(baby_bits=20); load_or_build(path); solve(&Point, max_value) -> Option<u64> /* giant steps from 0 */; decrypt(kp, ct, max) }
```
Tests: byte-layout equality with zk-sdk pod types (proptest), basepoint constant == dalek, `solve(v·G, 2^44)==v`,
cross-check with `decode_u32` below 2^32.

**`window-clearing`** (`#![no_std]`; implemented directly from spec §7.3: `S(r)=Σ_{t≤r} v^ASK_t`, `D(r)=Σ_{t≥r} v^BID_t`, `r* = min{ r : S(r) ≥ D(r) > 0 }`, `matched = min(S(r*), D(r*))`, pro-rata at the marginal tick):
```rust
pub const TICKS=37; MIN_BPS=100; TICK_BPS=25; BID_BITS=40;
pub enum Side { Ask=0, Bid=1 }   pub struct Tick(u8) { new, index, bps, is_band_edge }
pub struct DepthCurve { ask:[u64;37], bid:[u64;37] }
pub struct Clearing { r_star:Tick, matched:u64, supply_at:u64, demand_at:u64 }
pub fn cumulative(&DepthCurve) -> ([u64;37],[u64;37]);        // (S, D)
pub fn clear(&DepthCurve) -> Result<Option<Clearing>, ClearError>;
pub fn ask_allocation(&DepthCurve, &Clearing) -> AskAllocation { marginal_tick, marginal_ratio:Ratio } // §7.3 pro-rata at the marginal tick, disclosed in Print
pub fn bound_ok(sum:u64, bid_count:u32) -> bool;               // sum ≤ n·2^40
pub mod regime { State{stale,tau,consecutive_trades,edge_streak,band_edge}; enum Outcome{Trade(Tick),NoTrade,Missed}; fn step(State, Outcome, band_edge_epochs) -> State }  // §7.5–7.6, only implementation
```
Fixtures `fixtures/clearing.json` are **authored here from the §7.3 definition** (hand-computed cases: single cross, no overlap, multi-ask
marginal pro-rata, band-edge prints, all-zero, one-sided) plus a proptest that checks `clear()` against a brute-force evaluation of the
§7.3 formula over random curves. The same JSON drives the `sdk` vitest so TS and Rust agree by construction.

**`window-proofs`**:
```rust
pub mod scalar { COLLATERAL_BITS=32; PRICE_EXP=2; MULT_EXP=3; struct SolvencyScalars{k_c,k_l};
  fn price_scaled(price,expo)->Option<u64>; fn multiplier_scaled(f64)->Option<u64>; fn solvency_scalars(p,a,haircut_bps)->Option<SolvencyScalars>;
  fn scalar_bound_ok(&SolvencyScalars)->bool; fn delta(c,l,&SolvencyScalars)->Option<u64> }   // compiled into window_credit
pub mod bid      { BidProofs{ciphertext,opening,validity:GroupedCiphertext2HandlesValidityProofData,range:BatchedRangeProofU64Data}; build(member,auditor_pk,size,s_min) /* range on size−s_min, bit_lengths [40,24] */ }
pub mod pocd     { build(auditor,&Ciphertext,claimed_sum)->ZeroCiphertextProofData }
pub mod solvency { CollateralClaim{...range bit_lengths [32,32]}; build_collateral(borrower,auditor_pk,shares_milli); SolvencyProofs{delta_commitment,equality,range}; build(borrower,coll,c,loan,l,&SolvencyScalars) }
pub mod ix       { context_size::<U>(); create_and_verify(payer,ctx,authority,rent,&proof)->[Instruction;2]; verify_inline(&proof); close(ctx,dest,authority) }
pub mod verify   { EpochView; PrintView; PrintVerdict{coverage,proofs_ok,r_star_recomputed,ok}; print(&EpochView,&PrintView,&[ZeroCiphertextProofData]); LoanView; solvency(&LoanView,&eq,&range)->bool }  // feature "verify"
```
**`window-proofs-wasm`** exports: `keypair_from_signature`, `ae_key_from_signature`, `pubkey_validity_proof`, `bid_proofs`,
`collateral_claim`, `solvency_proofs`, `apply_pending_balance_data`, `withdraw_proofs`, `transfer_proofs`, `decrypt_equals`.
(`GroupedCiphertext2HandlesValidityProofData::new` has a separate `wasm32` constructor — `#[cfg(target_arch="wasm32")]` branch in `bid::build`.)

---

## Programs (Anchor 1.1.2)

Conventions for all five: `instructions/<name>.rs` one file each; `state.rs`, `events.rs`, `errors.rs`, `constants.rs`,
`seeds` consts; `Config` PDA `["config"]`; every gated ix `has_one`; all arithmetic `checked_*`; events never carry sizes;
`#[account(zero_copy)]` for `Epoch`/`Print` (Bourse pattern), `InitSpace` elsewhere; per-program `tests/` on LiteSVM.
Every consumed context: `owner == ZK program`, proof type matches, `context_state_authority == user` (read from
`ProofContextStateMeta`), then CPI `CloseContextState` (lamports → user).

### `window_registry`
PDAs `Config{admin, member_count}`, `Member["member", owner]{owner, elgamal_pubkey, joined_epoch, active, bump}`.
`initialize(admin)`, `add_member(owner, elgamal_pubkey, joined_epoch)` (admin; `ZeroKey`), `remove_member` (admin),
`update_elgamal_pubkey(new)` (owner).

### `window_auction`
PDAs `Config{admin, keeper, oracle_program, registry_program, auditor_elgamal_pubkey, cusdc_mint, cstock_mint, epoch_slots,
keeper_grace_slots, stale_after_slots, s_min, max_bids_per_epoch, epochs_opened, current_epoch, has_open_epoch}`,
`Epoch["epoch", index_le]` (spec §11 + `auditor_pubkey`, `total_bids`), `Bid["bid", epoch_le, member, side, tick]{…, ciphertext:[u8;96], slot}`.

| ix | signer | constraints → errors |
|---|---|---|
| `initialize(params)` | payer→admin | param sanity → `BadParams` |
| `open_epoch` | keeper | `!has_open_epoch`; stamps `auditor_pubkey`, `start_slot` → `PrevEpochStillOpen` |
| `close_epoch(index)` | keeper, or anyone after grace | `Open`, `slot ≥ start+epoch_slots`; idempotent → `WindowNotElapsed`, `NotKeeperBeforeGrace` |
| `submit_bid(side, tick)` | member; remaining `[validity_ctx, range_ctx]` | `tick ≤ 36`; `validity.first_pubkey == member.elgamal_pubkey`, `.second == epoch.auditor_pubkey`; `range.commitments[0] == shifted_commitment(validity.commitment, s_min)`, `bit_lengths[0]==40`; `total_bids < max`; accumulate (commitment, handles[1]); `bid_count[σ][t]+=1`; store in `Bid`; close ×2; emit `BidSubmitted{epoch,member,side,tick}` → `NotOpen, BadTick, MemberInactive, MemberKeyMismatch, AuditorKeyMismatch, RangeCommitmentMismatch, RangeBitLength, ContextAuthorityMismatch, BadContextOwner, TooManyBids, CurveError, AlreadyBidHere` |
| `mark_printed(index, outcome)` | `oracle_authority` PDA signer (`seeds=[b"authority"], seeds::program=config.oracle_program`) | `Closed` → `Printed|NoTrade` |
| `close_bid` | anyone; rent→member | epoch settled ∧ (no Loan or Loan passed) → `EpochNotSettled`, `BidStillReferenced` |
| `rotate_auditor(new)` | admin | `!has_open_epoch` → `EpochOpen` |

### `window_oracle`
PDAs `OracleState["oracle"]{admin, auction_program, last_print_epoch, has_printed, last_r_star_tick, stale, tau, consecutive_trade_prints,
edge_streak, regime_flags, prints}`, `Print["print", epoch_le]` (spec §11 + `status∈{Attesting,Missed,Printed,NoTrade}`, `nonzero_bitmap`,
`attested`, `missed`, `marginal_ratio`, `matches_posted`), signer PDA `["authority"]`.

| ix | signer | constraints → errors |
|---|---|---|
| `begin_print(epoch)` | admin | `Epoch.Closed`; init `Print`; nonzero bitmap from `bid_count`; zero ticks must be identity → `NotClosed, ZeroTickNotIdentity, PrintExists` |
| `attest_ticks(claims: Vec<TickClaim{side,tick,sum}>)` (≤4) | admin + Instructions sysvar | claim i ↔ proof ix at offset `−(len−i)` via `verify_and_extract_context::<ZeroCiphertextProofData,_>`; `ctx.pubkey==epoch.auditor_pubkey`; `ctx.ciphertext == acc.residual(sum)`; `bound_ok(sum, bid_count)`; set bit, store sum → `WrongProofType, ProofKeyMismatch, ResidualMismatch, SumExceedsBound, TickNotNonzero, TickAlreadyAttested, PrintNotAttesting` |
| `finalize_print(epoch, claimed_r_star: Option<u8>)` | admin | `proven == nonzero`; zero ticks sum 0; `clear()` == claimed; `regime::step`; write Print; CPI `mark_printed` with `["authority"]`; emit `Printed|NoTrade` → `CoverageIncomplete, RateMismatch, AlreadyFinalized` |
| `mark_stale(epoch)` | anyone | `Closed ∧ slot ≥ close_slot+stale_after_slots ∧ !finalized`; Print `Missed`/`missed=true`; `stale=true, tau+=1`; late finalize still allowed → `NotYetStale, AlreadyFinalized` |

### `window_wrap`
PDAs `Vault["vault", mock_mint]{mock_mint, cstock_mint, custody, wrapped}`, `mint_authority["mint_authority"]`, custody = ATA(vault, mock_mint).
`initialize` (mock mint has `ScaledUiAmount`; cstock mint has CT extension + auditor → `BadMintConfig`);
`wrap(amount)` (member: `transfer_checked` → custody, `mint_to`, CPI CT `Deposit`; `wrapped += amount`; emit `Wrapped{member}` — the token leg is public by nature (leak budget), the event does not repeat it);
`unwrap(amount)` (burn public balance, `transfer_checked` custody → member). Invariant: `cstock.supply == custody.amount == vault.wrapped`.

### `window_credit`
PDAs `Config{admin, operator, keeper, oracle_program, auction_program, registry_program, cstock_mint, mock_mint, escrow_account, feed_id,
haircut_bps=15000, max_price_age, tenor_slots}`, `PriceCache["price", feed_id]` (spec §11 + `posts`),
`Loan["loan", epoch_le, borrower, bid_tick, k]` (spec §11 + `bid_tick`, `fill:Ratio`, `collateral_ct:[u8;96]`, `delta_commitment`, `k_c`, `k_l`, `lock_slot`, `funded_slot`, `collateral_released`).

| ix | signer | constraints → errors |
|---|---|---|
| `post_price(price, expo, publish_time)` | keeper | `feed_id`, `price>0`, `publish_time ≥ prev` → `BadPrice, PriceRegressed` |
| `post_matches(epoch, matches: Vec<Match{borrower, lender, k, kind}>)` (≤3/tx) | admin; per match `borrower_bid, lender_bid, loan(init), [validity_ctx if Partial]` | `Print.Printed`; `borrower_bid.side==BID ∧ tick ≥ r*`; `lender_bid.side==ASK ∧ tick ≤ r*`; `Full ⇒ size_ct = borrower_bid.ciphertext`; `Partial ⇒ validity binds (borrower key, auditor)`; `loan.tick=r*`, `Pending` → `NotPrinted, WrongSide, TickNotFilled, BadPartialProof` |
| `lock_collateral` | borrower; remaining `[validity_ctx, range32_ctx, equality_ctx, range64_ctx]` (all context accounts — inline doesn't fit) | price fresh (`slot−posted_slot ≤ max_price_age`); multiplier from `mock_mint` `ScaledUiAmountConfig` → `multiplier_scaled`; `solvency_scalars`; `scalar_bound_ok`; validity keys; `range32.commitments[0]==validity.commitment, bits 32`; `E_Δ = solvency_delta(...)`; `eq.pubkey==member key, eq.ciphertext==E_Δ`; `range64.commitments[0]==eq.commitment, bits 64`; close ×4; store `price_at_lock, mult_at_lock, k_c, k_l, collateral_ct, delta_commitment` → `Requested`; emit `LockRequested` → `NotPending, PriceStale, ScalarBound, MultiplierInvalid, MemberKeyMismatch, AuditorKeyMismatch, CollateralRangeMismatch, DeltaMismatch, DeltaRangeMismatch, ContextAuthorityMismatch` |
| `deposit_collateral` | borrower + Instructions sysvar | ix[−1] = Token-2022 CT `Transfer` borrower ATA → `escrow_account` → `Deposited` (A5) → `NoEscrowTransfer, NotRequested` |
| `confirm_lock` | operator | `Deposited → Locked` |
| `confirm_funding` | admin | `Locked → Active`; `deadline_slot = slot + tenor_slots` |
| `repay` | admin | `Active → Repaid` |
| `seize` | anyone | `Active ∧ slot > deadline ∧ price fresh → Defaulted` → `NotMatured, PriceStale` |
| `release` / `seize_to` | operator (+ same-tx CT transfer introspection) | terminal flag `collateral_released` → `NotTerminal, AlreadyReleased` |

---

## Services, SDK, app

**`services/admin`** (Rust; `tokio`, `clap`, `tracing`, `window-config`): `lib.rs` orchestration over a `Chain` trait (mockable),
`main.rs` RPC impl. Modules: `keeper` (epoch clock, `post_price` from Pyth Hermes REST for the named 24/7 feed, `seize` scan, newest-first
backfill `ADMIN_BACKFILL_EPOCHS`, stall guard), `administrator` (on Closed: read
accumulators → BSGS → `clear` → PoCD ×N → `begin_print`/`attest_ticks`/`finalize_print` → decrypt `Bid`s → `ask_allocation` →
`post_matches`), `operator` (watch `Deposited` → `confirm_lock`; `release`/`seize_to` with CT transfer via proof-generation crate),
`price`, `metrics` (`/healthz`, `/metrics`: prints, tx/print, CU, wall-clock, keeper SOL balance + low-balance alert),
`redact` (tracing layer; `tests/redaction.rs` asserts no plaintext size ever logged).

**`services/indexer`** (TS: fastify, zod, pino, better-sqlite3 WAL, `migrations/`): `onLogs` + `getSignaturesForAddress` backfill,
append-only cursor with all-or-nothing commit, Anchor event decoding from frozen IDLs. Routes `/xonia`, `/xonia/history`,
`/depth/:epoch`, `/aggregates/:epoch`, `/loans`, `/members`, `/verify/:epoch` (runs `window-proofs::verify` via wasm), `/healthz`;
OpenAPI from zod.

**`services/agents`** (TS): `Strategy` interface (`RandomWalkAroundLastRate`, `LenderLadder`, `BorrowerCluster`), runner that funds/wraps/bids
each epoch through the SDK — same code path as a judge's wallet; labelled `simulated` in every event/UI.

**`sdk/`** (on `@solana/kit`, no `@solana/web3.js` v1 anywhere): `generated/` clients produced by `scripts/codegen.ts`
(`@codama/nodes-from-anchor` → `@codama/renderers-js`) from the frozen IDLs — instruction builders, account decoders, PDA helpers,
error enums for all five programs; Token-2022 CT and `ScaledUiAmount` instructions from `@solana-program/token-2022`; `accounts.ts`
fetchers, `tx.ts` builders (`buildBidTxs` = 3 txs: create validity+range contexts → verify range (own tx) → verify validity +
`submit_bid`; `buildLockTxs` = 3 proof txs + lock; `buildWrapTxs` = wrap + `applyConfidentialPendingBalance`), `rates.ts` (tick↔bps and
cumulative curves, same fixtures as `window-clearing`), `keys.ts` (`DERIVATION_MESSAGE`; ElGamal + AE keys from a wallet `signMessage`),
`verify.ts` (wasm; indexer fallback), `wasm/` build output. Pattern reference: `/Users/apple/Desktop/Bourse/sdk/src/{codec,decode,pda,adapters/rpc}.ts`.

**`app/`**: wallet-standard via `@solana/react` + `@wallet-standard/react` (`useWalletAccountTransactionSendingSigner`,
`useWalletAccountMessageSigner` for key derivation); `features/{market,explorer,borrow,positions}`, `api/` client from OpenAPI, no
business logic in components; `Home` (rate, countdown, series), `Explorer` (74 ciphertexts vs proven curve + "re-verified locally"
badge), `BorrowDesk` (onboard → wrap → bid → lock → draw), `Positions`; `src/lib/honestClaims.test.ts` (fails CI on
"trustless"/"undecryptable"/"nobody can see" — spec's honest-claims rule enforced mechanically).

---

## Tests — two tiers plus devnet (user decision)

| Tier | Substrate | What runs there | Why |
|---|---|---|---|
| 1 · Logic | **LiteSVM** (Agave's real program runtime + real SBF loader + real ZK builtin, in-process, exact `warp_to_slot`) | program unit tests, the 8 attack tests, proptest invariants, CU/tx measurements, the Phase-1 gate | seconds per full-epoch scenario; hundreds of cases |
| 2 · Integration | **`solana-test-validator`** (real Agave validator, real RPC, real slot clock) driven through the **TS SDK** | `tests/integration/` (vitest): full epoch with 5 agents → Printed → `verifyPrint`; borrow→repay; borrow→seize; wrap/unwrap; indexer `/verify/:epoch` against the node; admin service loop | exercises RPC, tx confirmation, real timing, the SDK transport, services — everything LiteSVM strips |
| 3 · Acceptance | **devnet** | `scripts/watch_epoch.ts`, judge walkthrough (`docs/DEMO.md`), overnight autonomous run | the deployment that is judged |

Integration profile: `config/integration.toml` (`epoch_slots = 20`, `tenor_slots = 20`, `stale_after_slots = 40`, `keeper_grace_slots = 10`,
`max_price_age = 30`) so a full lifecycle completes in ≈ 1 min of real slots; `scripts/localnet.sh` starts the validator with
`--bpf-program` ×5 and `--reset`, `scripts/check_localnet.sh` asserts the ZK feature/programs; `make test-integration` = start validator →
`setup_localnet.ts` → `vitest run --project integration` → teardown; CI job `integration` installs solana-cli 4.2.1 and runs it after
`anchor build`. `make demo` is the same harness with the DEMO profile and the dashboard pointed at it.

### Tier 1 detail (`tests/` = crate `window-tests`, `autotests=false`, `[[test]]` per suite; all on LiteSVM via `window-testkit`)

- `window-testkit`: loads 5 `.so` (`include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/x.so"))`, Bourse pattern) + bundled
  Token-2022 + ZK builtin; confidential mints with auditor; member CT accounts; `ProofFactory` over `window-proofs`; fluent `Scenario`
  (`.open_epoch().bid(alice, Bid, 8, usdc(1_000)).close().print().matches()…`).
- `measurements/gate_pocd.rs` — **the Phase-1 gate, kept permanently**: two bids at one tick → syscall accumulation → one PoCD attest →
  read `claimed_sum`; records CU for `submit_bid`, `VerifyZeroCiphertext`, `attest_ticks`; asserts `attest_ticks` tx < 200k CU.
  `print_cost.rs` (tx/bytes/CU at 1/10/37/74 nonzero ticks), `solvency_cost.rs`. `WINDOW_WRITE_MEASUREMENTS=1` rewrites `docs/measurements.json`.
- `e2e/full_epoch.rs` (5 members, ρ=1, Printed), `e2e/loan_lifecycle.rs` (borrow→repay, borrow→seize).
- `attacks/attack_01_false_sum.rs` … `attack_08_rebase_replay.rs` — spec §15 list, each asserts the exact error code; written **before** the code they attack.
- `invariants/` — proptest state-machine over `Scenario` (spec §15 invariant list): collateral conservation, wrap supply==custody,
  deadline safety, no double terminal, `matched ≤ min(S,D)`, epoch monotonicity, scalar bound for every asset in `config/*.toml`.
- TS unit: vitest in sdk/indexer/agents/app; `sdk` fixtures == `crates/window-clearing/fixtures/clearing.json`.
- Docs guardrail: Rust test greps `README.md`, `docs/*.md` for forbidden claims.

### Tier 2 detail (`tests/integration/`, vitest project `integration`, TS via `@thewindow/solana-sdk`)

- `harness.ts`: spawn/attach validator (`LOCALNET_URL` or spawn), load `deployments/localnet.json`, fund keypairs, `waitForSlot`, `waitForEvent`.
- `full_epoch.test.ts` (agents bid → keeper closes at the slot gate → admin service prints → `verifyPrint` ok → `close_bid` refunds rent),
  `loan_repay.test.ts`, `loan_seize.test.ts` (waits real `tenor_slots`), `wrap_unwrap.test.ts` (supply == custody from RPC),
  `stale_print.test.ts` (admin paused → `mark_stale` by anyone → late finalize), `indexer.test.ts` (`/xonia`, `/verify/:epoch` against the node).
- Each test runs the **same admin/agents binaries** used on devnet (spawned with `WINDOW_PROFILE=integration`), so services are tested, not mocked.

---

## Fresh build guarantee (amendment A9)

The spec's §9/§10/§16 mention copying the Avalanche `window-clearing` fixtures and porting `computeClearing`. **Overridden by the
user:** nothing is taken from `/Users/apple/Desktop/The Window/`. Concretely: the clearing rule is implemented from the §7.3 formula
with fixtures authored here and a brute-force proptest as the oracle; attack and invariant tests come from spec §15; service loops,
indexer, SDK and dashboard are written for Solana primitives (`@solana/kit`, Token-2022 CT, ZK ElGamal) with no EVM/eERC/circom
lineage; docs are written fresh (`docs/SPEC.md` is this repo's own spec). A CI check (`scripts/check_lineage.sh`) fails if any file
contains `eERC`, `BabyJubJub`, `circom`, `snarkjs`, `M-ONIA`, `MONIA`, or `Avalanche` outside `docs/SPEC.md` §3/§6/§11 where the
spec itself names its lineage.

## Execution sequence (each step leaves `cargo build` / `pnpm typecheck` green)

| # | Phase | Step | Green when |
|---|---|---|---|
| 0.0 | 0 | Toolchain: `cargo install wasm-pack` if absent; optional `rustup update stable` (→1.98.1, unlocks `litesvm 0.16`); Anchor stays **1.1.2** (verified). Record in `docs/toolchain.md` | `anchor --version` = 1.1.2; `wasm-pack --version` |
| 0.1 | 0 | `git init`; **`docs/BUILD_PLAN.md` ← this plan (verbatim, first commit)**; skeleton files listed in layout; `docs/SPEC.md` ← `readme.md`; `README.md` stub with §14 verbatim + Amendments A1–A9; `docs/toolchain.md` | `cargo metadata && pnpm install`; `docs/BUILD_PLAN.md` present |
| 0.2 | 0 | `config/{demo,integration,prod}.toml` + `crates/window-config` | `cargo test -p window-config` |
| 0.3 | 0 | `scripts/localnet.sh` + `scripts/check_localnet.sh` (validator up, ZK feature active, Token-2022 + ZK program executable) | `./scripts/check_localnet.sh` exits 0 |
| 0.4 | 0 | `window-clearing` from §7.3 + self-authored fixtures + brute-force proptest + `regime` | `cargo test -p window-clearing` |
| 0.5 | 0 | `.github/workflows/ci.yml` (jobs `rust-fast`, `programs`, `ts`, `integration` (installs solana-cli 4.2.1, runs `make test-integration`), `docs` (honest-claims grep + `scripts/check_lineage.sh`)) | YAML valid |
| 1.1 | 1 | `window-elgamal` core + std (layout/roundtrip/bsgs proptests) | `cargo test -p window-elgamal --all-features` |
| 1.2 | 1 | `window-proofs` `scalar`, `bid`, `pocd`, `ix` | `cargo test -p window-proofs` |
| 1.3 | 1 | `window_registry` complete | `anchor build -p window_registry` |
| 1.4 | 1 | `window_auction`: `initialize`, `open_epoch`, `close_epoch`, `submit_bid`, `Bid` | `anchor build -p window_auction` |
| 1.5 | 1 | `window_oracle`: `initialize`, `begin_print`, `attest_ticks` | `anchor build -p window_oracle` |
| 1.6 | 1 | `window-testkit` (SVM bootstrap, mints, members, `ProofFactory`) | `cargo test -p window-testkit` |
| **1.7** | 1 | **THE GATE** `tests/measurements/gate_pocd.rs` — grown from the verified scratchpad spikes (`zk-spike/`, `anchor-spike/`), now driven through the real `submit_bid`/`attest_ticks` instructions | `anchor build && cargo test -p window-tests --test measurements gate_pocd -- --nocapture` |
| 1.8 | 1 | `docs/adr/ADR-001-proof-delivery.md`, `ADR-002-bsgs-vs-lo-hi.md`, `ADR-003-litesvm.md`; gate row in `docs/measurements.json` | files exist; gate green |
| 2.1 | 2 | `finalize_print`, `mark_stale`, `OracleState`, CPI `mark_printed`; auction `mark_printed`, `close_bid`, `rotate_auditor` | `anchor build && cargo test -p window_oracle -p window_auction` |
| 2.2 | 2 | `Scenario` fluent API; `tests/e2e/full_epoch.rs` (5 members, ρ=1) | `cargo test -p window-tests --test e2e` |
| 2.3 | 2 | Attack tests 1–5 | `cargo test -p window-tests --test attacks` |
| 2.4 | 2 | `scripts/sync_idl.sh`; indexer skeleton (spec §18: early) | `pnpm --filter @thewindow/indexer test` |
| 2.5 | 2 | `tests/measurements/print_cost.rs` | measurements suite green |
| 3.1 | 3 | `scripts/mints.ts` (mock-xStock: ScaledUiAmount + MetadataPointer/TokenMetadata + PermanentDelegate; confidential mints) + testkit mirror | `cargo test -p window-testkit mints` |
| 3.2 | 3 | `window_wrap` + supply==custody test | `anchor build -p window_wrap && cargo test -p window_wrap` |
| 3.3 | 3 | `window-proofs::{solvency,verify}` | `cargo test -p window-proofs --features verify` |
| 3.4 | 3 | `window_credit` complete | `anchor build -p window_credit && cargo test -p window_credit` |
| 3.5 | 3 | `tests/e2e/loan_lifecycle.rs` | e2e green |
| 3.6 | 3 | Attack tests 6–8; `tests/invariants/*`; **`tests/privacy/{idl_surface,leak_audit}.rs`** | `cargo test -p window-tests --test attacks --test invariants --test privacy` |
| 3.7 | 3 | `tests/measurements/solvency_cost.rs` | measurements green |
| 4.1 | 4 | `services/admin` (+ `tests/{redaction,orchestration}.rs` with mock `Chain`) | `cargo test -p window-admin` |
| 4.2 | 4 | `sdk/` core: `scripts/codegen.ts` (codama from frozen IDLs → `sdk/src/generated`), fetchers, tx builders, `rates.ts` | `pnpm codegen && pnpm --filter @thewindow/solana-sdk test` (generated clients round-trip the LiteSVM fixtures) |
| 4.3 | 4 | `services/agents` | `pnpm --filter @thewindow/agents test` |
| **4.3b** | 4 | **Tier-2 integration suite** `tests/integration/{harness,full_epoch,loan_repay,loan_seize,wrap_unwrap,stale_print,indexer,leak_audit}.test.ts` on `solana-test-validator` with the real admin/agents binaries | `make test-integration` exits 0 (< 10 min) |
| 4.4 | 4 | `make demo` (`scripts/demo.sh`: same harness, DEMO profile, dashboard attached; wait `Printed(1)` → `verifyPrint(1)` → teardown, 6-min timeout) | `make demo` exits 0 |
| 4.5 | 4 | `scripts/deploy_devnet.sh`, `setup_devnet.ts`, `watch_epoch.ts`; `deployments/devnet.json`; keeper key funded ≥20 SOL (Epoch rent ≈0.036 SOL × 30/h) | `watch_epoch.ts --epochs 1` exits 0 |
| 5.1 | 5 | `window-proofs-wasm` → `sdk/wasm/` (`scripts/build_wasm.sh`) | `wasm-pack build --target web`; sdk `wasm.test.ts` |
| 5.2 | 5 | SDK `verifyPrint`/`verifySolvency`; indexer `/verify/:epoch` | vitest + indexer test on a recorded devnet epoch |
| 5.3 | 5 | `app/` | `pnpm --filter @thewindow/app typecheck && test && build` |
| 5.4 | 5 | `docs/DEMO.md` judge walkthrough from a clean devnet wallet | manual checklist passes |
| 6.1 | 6 | `scripts/leak_audit.ts`, `measurements_to_md.mjs` → README; `METHODOLOGY.md`, `THREAT_MODEL.md` (§13 table with test cross-refs) | `pnpm run docs:measurements` no diff in CI |
| 6.2 | 6 | `solana program set-upgrade-authority <id> --final` ×5; tag `v1.0.0-stocklana` | `solana program show` → `Authority: none`; clean clone `make demo` green |

Cut order under pressure (spec §22, unchanged): receiver-read stretch → unwrap → positions page → lender UI → auditor-rotation demo.
`deposit_collateral` introspection (A5) is the first *plan-level* extra to drop if Phase 3 slips.

---

## Verification

```bash
# Rust hygiene
cargo fmt --all -- --check && cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --exclude window-tests             # crates + program unit tests
# Programs (LiteSVM tests need target/deploy/*.so — cargo test does not build SBF)
anchor build && ./scripts/sync_idl.sh --check && cargo test --workspace
cargo test -p window-tests --test e2e
cargo test -p window-tests --test attacks                 # 8 attacks, exact error codes
cargo test -p window-tests --test privacy                 # IDL surface allowlist + on-chain/log leak audit (zero plaintext sizes)
PROPTEST_CASES=64 cargo test -p window-tests --test invariants
cargo test -p window-tests --test measurements -- --nocapture
# TypeScript / wasm
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @thewindow/app build
./scripts/build_wasm.sh
# Tier 2 — real validator (solana-test-validator), real RPC, real slots, real services
./scripts/check_localnet.sh
make test-integration                                     # = scripts/localnet.sh → setup_localnet.ts → pnpm vitest run --project integration → teardown
make demo                                                 # same harness, DEMO profile, dashboard attached
# Devnet
solana feature status zkhiy5oLowR7HY4zogXjCjeMXyruLqBwSWH21qcFtnv -ud
anchor deploy --provider.cluster devnet && pnpm tsx scripts/setup_devnet.ts
WINDOW_CLUSTER=devnet cargo run -p window-admin --release &
pnpm tsx scripts/watch_epoch.ts --epochs 1                # Printed + verifyPrint ok; prints tx count / wall-clock
```

## Residual risks (stated in README / THREAT_MODEL)

- `attest_ticks`: 4 inline PoCDs measured at 954 B before the consuming ix and its accounts — default batch **3**, 4 only if the measured full tx stays < 1,232 B (v0 + ALT is the upgrade path to 5/tx).
- Toolchain: if `rustup update` is deferred, LiteSVM must stay at 0.10.0 (agave 3.1 runtime, verified) — CU numbers may differ slightly from devnet's 4.2 runtime; the measurement tests re-run after the update.
- f64 `ScaledUiAmount` read on SBF verified in the gate; fallback `set_multiplier_override`.
- wasm build of `spl-token-confidential-transfer-proof-generation` unverified here; fallback = admin `/prove` helper for the judge flow (documented as demo shortcut).
- `PermanentDelegate` on the mock mint lets the issuer claw custody — true of real xStocks; documented.
- Devnet SOL: Epoch accounts are kept (verifyPrint needs accumulators); Bid/context rent is reclaimed.
