# ADR-003 · Two test tiers: LiteSVM and a real validator

**Status:** accepted (user decision: "both").

**Context.** LiteSVM runs Agave's real program runtime, SBF loader and builtins in-process with an
exact slot clock — seconds per full-epoch scenario. It strips RPC, transaction confirmation, real
timing and the services. LiteSVM 0.10 (Agave 3.1) also accepted zk-sdk-4 proofs that Agave 4.2
rejects (transcript change in zk-sdk 5.0), which hid a fatal bug until the first real-validator run.

**Decision.** Tier 1 (`tests/`, LiteSVM 0.16 = Agave 4.2 runtime, plus the devnet dump of
Token-2022 with zk-ops): programs, the eight attack tests, invariants, privacy audits, CU/size
measurements. Tier 2 (`tests/integration`, `solana-test-validator` 4.2.1): the TypeScript SDK —
the dashboard's code path — against the real admin service and agents, one full lifecycle plus an
RPC leak audit. Tier 3: devnet, `scripts/watch_epoch.ts`.

**Consequences.** Every proof path is exercised on the runtime that devnet runs. `make test`
takes minutes; `make test-integration` about three; CI runs both.
