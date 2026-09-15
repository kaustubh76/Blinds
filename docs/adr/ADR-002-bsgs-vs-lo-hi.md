# ADR-002 · Decrypting aggregates: BSGS over ≈2^44 instead of lo/hi splitting

**Status:** accepted.

**Context.** Per-tick sums reach `n·2^40` µUSDC. `solana-zk-sdk`'s `decode_u32` covers 32 bits;
Token-2022 splits balances into 16-bit lo / 32-bit hi ciphertexts to stay decodable. Splitting bid
ciphertexts would double every proof and the on-chain accumulator.

**Decision.** One 40-bit range proof per bid, one accumulator per tick, and a baby-step giant-step
solver in `window-elgamal::bsgs` on the administrator's side (2^20 baby table by default; giant
steps from 0 so realistic sums decode instantly; 2^44 worst case ≈ 28 s with a 22-bit table).
Members decrypt their own small values (loan parts) with a 2^16 table in wasm.

**Consequences.** A poisoned tick (oversized bid) would blow up the solver — prevented by the
range proof at submit and `bound_ok(sum, n)` at attest (attack test 5). The auditor decrypts
per-tick aggregates first; that is the disclosed trust.
