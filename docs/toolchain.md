# Toolchain — pinned versions and the traps behind them

Resolved 2026-09-15 (Phase 0). Everything here was verified empirically on the build machine:
the crate set was compiled on the host, built for SBF with the installed Anchor CLI, and the
resulting program was executed inside LiteSVM against the real ZK ElGamal Proof program.

## Pinned

| Component | Version | Why this one |
|---|---|---|
| solana-cli / Agave | **4.2.1** | Installed; devnet runs 4.2/4.3. Ships platform-tools 1.52 (rustc 1.89 for SBF). |
| anchor-cli / anchor-lang / anchor-spl | **1.1.2** (exact) | Installed CLI. `anchor build` + on-chain execution verified. 1.2.0 is the same `solana-*` 3.x crate family and compiles on the host; move both CLI and crates together, then re-run the gate test. |
| solana-zk-sdk | **4.0.0** (exact) | The version `anchor-spl 1.1.2 → spl-token-2022-interface 2.1.0 → proof-extraction 0.5.1` already carries. |
| solana-curve25519 | **3.1.14** (exact) | Same family; host = dalek, SBF = syscalls, one API. |
| spl-token-2022-interface | **2.1.0** (exact) | What anchor-spl uses. Confidential-transfer instruction builders live here. |
| spl-token-confidential-transfer-proof-extraction / -generation | **0.5.1** (exact) | `verify_and_extract_context` (programs) and transfer/withdraw proof builders (services). |
| litesvm / litesvm-token | **0.10.0** (exact) | Agave 3.1 runtime; bundles Token-2022 v10 and the ZK ElGamal builtin; compiles on Rust 1.90. |
| Rust (host) | 1.90.0 | Installed stable. |
| Node / pnpm | ≥ 24 / 10.12.4 | `packageManager` pinned in `package.json`. Never `npm`. |
| @solana/kit / @solana-program/token-2022 | 8.x / 0.17 | The current JS SDK line. `@solana/web3.js` 1.x is the maintenance branch and is not used anywhere. |

## Traps (each cost real time; do not rediscover them)

1. **`solana-zk-sdk` 7/8 and `spl-token-confidential-transfer-proof-extraction` 0.6 are not usable with Anchor 1.x.**
   They moved to `solana-address` and `solana-instruction 4`; Anchor 1.x is on `solana-instruction 3`. Cargo will
   either refuse to resolve or produce two incompatible copies of the pod types. Wait for the Anchor release that
   moves with them.
2. **LiteSVM ≥ 0.14 needs Rust ≥ 1.97.** It pulls the Agave 4.2 runtime crates (`solana-syscalls 4.2.2`) which use
   `maybe_uninit_write_slice`, unstable on 1.90. After `rustup update stable` (1.98.1) `litesvm 0.16` resolves
   cleanly with this pin set (verified) and gives the devnet runtime version; until then stay on 0.10.
3. **`litesvm 0.13` pins `solana-instruction = "=3.2.0"`**, which conflicts with Anchor's `^3.3`. Skip it.
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
