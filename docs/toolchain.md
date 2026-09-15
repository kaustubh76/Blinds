# Toolchain — pinned versions and the traps behind them

Resolved 2026-09-15 (Phase 0). Everything here was verified empirically on the build machine:
the crate set was compiled on the host, built for SBF with the installed Anchor CLI, and the
resulting program was executed inside LiteSVM against the real ZK ElGamal Proof program.

## Pinned

| Component | Version | Why this one |
|---|---|---|
| solana-cli / Agave | **4.2.1** | Installed; devnet runs 4.2/4.3. Ships platform-tools 1.52 (rustc 1.89 for SBF). |
| anchor-cli / anchor-lang / anchor-spl | **1.1.2** (exact) | Installed CLI. `anchor build` + on-chain execution verified. 1.2.0 is the same `solana-*` 3.x crate family and compiles on the host; move both CLI and crates together, then re-run the gate test. |
| solana-zk-sdk | **7.0.1** (exact) | Proof *generation*. Carries the zk-sdk ≥ 5 transcript that the deployed ZK ElGamal program (Agave ≥ 4.2) verifies. See trap 1. |
| solana-zk-elgamal-proof-interface / solana-zk-sdk-pod | **0.1.3 / 0.1.2** (exact) | Proof-data and context types, instruction encoding, `ProofContextState` — what the programs read. On `solana-instruction 3` (Anchor 1.x). |
| solana-curve25519 | **4.0.1** (exact) | host = dalek, SBF = syscalls, one API. |
| spl-token-2022-interface | **3.1.1** (exact) | Confidential-transfer and `ScaledUiAmount` instruction builders, extension parsing. (anchor-spl 1.1.2 carries its own 2.x internally; the two coexist.) |
| spl-token-confidential-transfer-proof-extraction / -generation | **0.6.1** (exact) | `verify_and_extract_context` (programs) and transfer/withdraw proof builders (services, wasm). |
| litesvm / litesvm-token | **0.16.0** (exact) | Agave 4.2.2 runtime = devnet's; its ZK ElGamal builtin verifies the same transcript as devnet. Needs Rust ≥ 1.97. |
| Rust (host) | 1.98.1 | Required by the Agave 4.2 crates LiteSVM 0.16 links. |
| Node / pnpm | ≥ 24 / 10.12.4 | `packageManager` pinned in `package.json`. Never `npm`. |
| @solana/kit / @solana-program/token-2022 | 8.x / 0.17 | The current JS SDK line. `@solana/web3.js` 1.x is the maintenance branch and is not used anywhere. |

## Traps (each cost real time; do not rediscover them)

1. **`solana-zk-sdk` 5.0 changed the proof transcripts** (a global domain separator
   `solana-zk-elgamal-proof-program-v1` and the proof context hashed into the transcript — the post-audit
   hardening). The deployed ZK ElGamal Proof program (Agave ≥ 4.2, i.e. devnet and mainnet today) verifies that
   transcript. Proofs built with zk-sdk 4.x verify in LiteSVM 0.10 (Agave 3.1) and are **rejected by a real
   validator** (`SigmaProof(PubkeyValidity, AlgebraicRelation)`). Generate proofs with zk-sdk ≥ 5 — 7.0.1 here,
   whose transcript is byte-identical to 5.0.1 — and test on LiteSVM ≥ 0.14. zk-sdk 8 / interface 1.0 move to
   `solana-instruction 4` and cannot be combined with Anchor 1.x yet.
2. **LiteSVM ≥ 0.14 needs Rust ≥ 1.97** (Agave 4.2 runtime crates use `maybe_uninit_write_slice`). LiteSVM 0.13
   pins `solana-instruction =3.2.0`, which conflicts with Anchor's `^3.3`. Use 0.16.
2b. **LiteSVM's bundled Token-2022 is built without `zk-ops`** — every confidential-transfer instruction returns
   `InvalidInstructionData`. The harness and the local validator load the *deployed* Token-2022 dumped from devnet
   (`scripts/fetch_external_programs.sh`, checksum committed).
4. **Anchor 1.x API:** `Context<'info, T<'info>>` has a single lifetime. The Instructions sysvar is not an Anchor
   `Sysvar<T>`; declare it as `UncheckedAccount` with `#[account(address = solana_instructions_sysvar::ID)]`.
5. **`verify_and_extract_context` does not check the context account's authority.** Programs read
   `ProofContextStateMeta` and require `context_state_authority == the user` before consuming, and
   `CloseContextState` needs that authority as a *signer* (the user's signature propagates through CPI).
6. **Transaction size decides proof delivery.** `ZeroCiphertextProofData` is 192 B (inline, several per tx);
   `BatchedRangeProofU64Data` is 936 B (its own tx, into a context-state account). Measured, not estimated.
7. **`anchor build 2>&1 | tail` reports `tail`'s exit code.** Use `set -o pipefail` (the Makefile does).
8. **`solana-curve25519` is "Agave unstable API".** Its functions are `#[deprecated]` unless the
   `agave-unstable-api` feature is on. The *syscalls* (`sol_curve_group_op`, `sol_curve_multiscalar_mul`)
   are activated protocol features and stable; only the Rust wrapper's shape may change. All curve calls
   go through `window_elgamal::point`, so a wrapper change is a one-file fix.
9. **Program keypairs** live in `deployments/program-keypairs/` (git-ignored) and are copied into
   `target/deploy/` before `anchor build` so `declare_id!` and `Anchor.toml` agree across machines.

## Feature gates (checked live)

| Feature | devnet | mainnet |
|---|---|---|
| `zkhiy5oLowR7HY4zogXjCjeMXyruLqBwSWH21qcFtnv` ZkElGamalProof program (SIMD-0153) | active (epoch 801) | active |
| `7rcw5UtqgDTBBv2EcynNfYckgdAaH1MAsCjKgXMkN7Ri` curve25519 syscalls | active | active |
| `zkiTNuzBKxrCLMKehzuQeKZyLtX2yvFcEKMML8nExU8` proof-from-account | inactive | inactive → proofs travel in instruction data |

`scripts/check_localnet.sh` asserts the first two on any validator before tier-2 tests run.
