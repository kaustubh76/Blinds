# ADR-001 · How proofs reach the programs

**Status:** accepted (Phase 1 gate, re-verified on Agave 4.2).

**Context.** A Solana transaction is 1,232 bytes. `ZeroCiphertextProofData` is 192 B,
`GroupedCiphertext2HandlesValidityProofData` 320 B, `BatchedRangeProofU64Data` 936 B. The spec's
`finalize_print(claimed_sums[74])` cannot carry 74 proofs; the ZK ElGamal Proof program offers two
delivery paths: inline (same transaction, read through the Instructions sysvar) or a context-state
account written by a separate `Verify*` transaction.

**Decision.** Small proofs go inline, immediately before the consuming instruction, found with
`verify_and_extract_context` at a negative offset: PoCDs in `attest_ticks` (≤ 4 per transaction,
measured 1,182 B), the bid validity proof in `submit_bid`, the pubkey-validity proof in
`ConfigureAccount`. Range proofs (936 B) always go to a context-state account created and
verified in their own transactions and closed by CPI with the user's signature propagating
(`window_auction::submit_bid`, `window_credit::lock_collateral`, Token-2022 transfers). Programs
check `context_state_authority == user` themselves — the extraction helper only checks owner and
proof type.

**Consequences.** Print = `begin_print` + ⌈nonzero/4⌉ `attest_ticks` + `finalize_print`
(74 nonzero ticks → 21 transactions, 917,924 CU, measured). Bid = 3 transactions; lock = 6;
escrow deposit = 6. Rent of context accounts returns to the user on close.
