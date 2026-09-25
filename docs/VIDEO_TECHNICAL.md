# The technical explainer — 8 to 9 minutes

Narration for a recorded technical walkthrough, written for a judge who knows Solana and roughly what a
zero-knowledge proof is, but not Token-2022's confidential balances or twisted ElGamal. The 3-minute product demo is
[`VIDEO_DEMO.md`](VIDEO_DEMO.md); the live/booth script is [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

Nine sections, each a clean cut point so you can record them one at a time. **1,448 spoken words ≈ 9:03**
at a presenting pace of 160 words per minute; the per-section timings assume that pace. To land nearer eight minutes
flat, drop §6 — the cost model is the one section the other eight do not depend on.

**On screen**: frames of [`project.excalidraw`](project.excalidraw) for architecture, the live dashboard for proof of
life, and two code snippets — both reproduced here, so this file also reads standalone.

---

## §1 · 0:00–0:36 — the claim

**Screen:** `project.excalidraw`, the START HERE strip.

> "THE WINDOW is a private margin desk for tokenized stocks. Holders pledge tokenized shares, borrow USDC overnight,
> and the market clears at one rate — xONIA — published every window.
>
> The hard part isn't the lending. It's that securities financing only works if nobody sees your size, and a public
> chain shows everything. So every amount here stays encrypted: encrypted bids, an encrypted order book, encrypted
> collateral — and the desk still clears an auction and margins a loan against them.
>
> All of it on Solana's native confidential primitives. No custom circuits, no trusted setup, no new cryptographic
> assumptions."

---

## §2 · 0:36–1:38 — why there is an administrator at all

**Screen:** the actors frame, then the causal chain from `SPEC.md` §8.

> "The first question to ask is why this isn't fully on chain. Three structural reasons.
>
> One: the per-tick totals are ciphertexts under the auditor key, and decrypting needs a secret. No program can hold a
> secret — Solana accounts are public.
>
> Two: the proof that a decryption is correct is a proof of *knowledge* of that secret, so it must be generated where
> the secret lives. Off chain.
>
> Three: Solana has no scheduler. Windows open and close because someone sends a transaction.
>
> So there is an off-chain administrator holding the auditor key. That is the trust surface, and we name it on every
> page. What the proof program buys us is that the administrator is *accountable* rather than *trusted*: every number
> it publishes arrives with a proof the chain verifies, and the rate is recomputed on chain from the proven numbers.
> The spec puts it in one line — **without the proof program the curve is an attestation; with it, the curve is
> proven.**"

---

## §3 · 1:38–2:43 — what a sealed bid actually is

**Screen:** the cryptography frame, then the Desk sealing a bid.

> "Sizes are encrypted with twisted ElGamal over Ristretto — the scheme Token-2022 uses for confidential balances.
> That's deliberate: the collateral leg and the auction leg speak the same cryptography.
>
> A bid is a *grouped* ciphertext with two decryption handles — one for the member, one for the desk's auditor — over
> a single commitment to the size. The rate and the side are public: thirty-seven ticks, one to ten percent. The size
> is not.
>
> The useful property is additivity: add two ciphertexts, you get the ciphertext of the sum. So the auction keeps
> seventy-four running totals — two sides, thirty-seven ticks — and each bid is added into one with a curve syscall,
> nothing decrypted. The order book fills while staying sealed.
>
> A bid costs three transactions, and the reason is size. A Solana transaction is 1,232 bytes. The validity proof is
> 320 bytes and rides inline, immediately before `submit_bid`. The range proof is 936 — too big to share a transaction,
> so it's verified into a context account first, which the program consumes and closes, returning the rent."

---

## §4 · 2:43–4:07 — the print, and why you can't fake it

**Screen:** the code below, then the Explorer re-verifying a print.

> "At the close, the administrator strips the randomness from each total with the auditor key, leaving a curve point
> that is the sum times the generator. Recovering the number is a bounded discrete log, solved with baby-step
> giant-step. Token-2022 solves the same problem by splitting balances into a sixteen- and a thirty-two-bit
> ciphertext — but splitting every *bid* would double every proof and the accumulator, so instead: one forty-bit range
> proof per bid, and a million-entry baby table on the administrator's side. That's an ADR.
>
> Then the part that matters. Each total is published with a proof that the *residual* — the on-chain total minus the
> claimed number — encrypts zero under the auditor key. Here is the binding, in the oracle program."

```rust
require!(bound_ok(claim.sum, epoch.bid_count[s][t]), OracleError::SumExceedsBound);

// The proof for claim i sits at relative offset −(n − i).
let ctx_data: ZeroCiphertextProofContext =
    verify_and_extract_context::<ZeroCiphertextProofData, _>(
        &mut empty.iter(), -(n - i as i64), Some(&ix_info),
    ).map_err(|_| error!(OracleError::WrongProofType))?;
require!(bytes_of(&ctx_data.pubkey) == epoch.auditor_pubkey, OracleError::ProofKeyMismatch);

// Bind: the proven ciphertext must be exactly (C_t − sum·G, D_t) from the frozen accumulator.
let acc = Ciphertext {
    commitment: Point(epoch.acc_commitment[s][t]),
    handle: Point(epoch.acc_handle[s][t]),
};
let residual = acc.residual(claim.sum).map_err(|_| error!(OracleError::CurveError))?;
require!(bytes_of(&ctx_data.ciphertext) == residual.to_bytes(), OracleError::ResidualMismatch);
```

*(`programs/window_oracle/src/instructions/attest_ticks.rs`)*

> "The program doesn't take the proof's word for what it is about. It rebuilds the residual itself from the frozen
> accumulator and the claimed number, and requires the verified proof to be about exactly that, under this window's
> auditor key. A proof for a different number, or one replayed from another window or tick, fails the binding.
>
> Then `finalize_print` requires every non-empty tick to be proven and recomputes the rate itself. Correct proofs with
> a wrong rate are rejected. That's four of our attack tests.
>
> And anyone can redo the whole thing — the Explorer runs the same verifier, compiled to WebAssembly, in your browser."

---

## §5 · 4:07–5:23 — priced solvency without revealing the position

**Screen:** the code below, then Positions locking a loan.

> "Now the margin check. The borrower has an encrypted collateral amount and an encrypted loan. The price and the
> haircut are public. We need collateral times price to be at least haircut times loan — without opening either.
>
> Scalar multiplication is the other half of the homomorphic property, so the *program* forms the difference itself."

```rust
// E_Δ = k_c·E_c − k_l·E_ℓ under the borrower's handles, via curve syscalls.
let e_delta = solvency_delta(&e_c, scalars.k_c, &e_l, scalars.k_l)
    .map_err(|_| error!(CreditError::CurveError))?;
require!(bytes_of(&equality.pubkey) == borrower_key, CreditError::MemberKeyMismatch);
require!(bytes_of(&equality.ciphertext) == e_delta.to_bytes(), CreditError::DeltaMismatch);
require!(
    bytes_of(&range64.commitments[0]) == bytes_of(&equality.commitment),
    CreditError::DeltaRangeMismatch
);
require!(range64.bit_lengths[0] == 64, CreditError::DeltaRangeMismatch);
```

*(`programs/window_credit/src/instructions/lock_collateral.rs`)*

> "`k_c` is the price in cents times the corporate-action multiplier; `k_l` is the haircut. The borrower supplies a
> commitment to that difference, a proof it equals the ciphertext the program just built, and a proof it's a
> non-negative sixty-four-bit number. If the pledge were short the difference would be negative — which wraps to an
> enormous field element and cannot pass a range proof. You cannot be undercollateralised and still produce the proof.
>
> Two details. The multiplier scales the *scalar*, not the ciphertext, so a ten-for-one split changes a public number
> and leaves every encrypted balance untouched. And the price must be fresh twice over — the keeper posted recently,
> *and* the quote's own timestamp is recent — checked at lock and again at seizure. When Pyth's account for our
> wrapper feed went quiet on the twelfth of September, the chain started refusing those loans. Inaction, never a wrong
> action."

---

## §6 · 5:23–6:10 — what it costs

**Screen:** the programs frame, then the measurements table in the README.

> "Because proofs are large and transactions are small, the cost model is a design constraint rather than an
> afterthought. A print is `begin_print`, then batches of `attest_ticks` carrying four inline proofs each — measured at
> 1,182 of the available 1,232 bytes — then `finalize_print`.
>
> Measured on Solana's real runtime: one non-empty tick is three transactions, ten is five, thirty-seven is twelve,
> and the absolute worst case — all seventy-four ticks occupied — is twenty-one transactions and about 1.02 million
> compute units. A bid is three transactions, a collateral lock six, the escrow deposit six.
>
> The programs are compiled for size rather than speed, because program-data rent is paid once and permanently: that
> trades some compute for about half a SOL and leaves the binding constraint, transaction count, unchanged."

---

## §7 · 6:10–7:09 — proven, attested, and public

**Screen:** the leak-budget frame, then the Build page's live schedule.

> "Being precise about what is proven matters more than the marketing. Every published total is proven and the rate
> recomputed on chain; the collateral check is proven. But funding and repayment *magnitudes* are administrator
> attestations — the program enforces the lifecycle, not the transfer size — and closing that is a roadmap item. The
> PreStocks mark is a keeper-attested copy of a public API, not a signed feed. All three are labelled on the pages.
>
> The leak budget is explicit: membership, side, tick, timing, the totals after the print, the rate and the price used
> at lock are public by design; individual sizes, balances and openings never appear in plaintext anywhere. An audit
> walks every account, transaction and log looking for them, and finds zero leaks.
>
> Behind that, thirty-two attack cases across two tiers — one in-process on Solana's real runtime, one against an
> actual validator, because the in-process runtime will happily accept a call to a program that isn't deployed."

---

## §8 · 7:09–8:30 — the integrations, as engineering

**Screen:** the Agent page, then `deployments/launch-mainnet.json`.

> "Four integrations, each doing a job rather than wearing a logo.
>
> Pyth is the coefficient inside the solvency proof and the gate on seizure — you saw it in the code.
>
> PreStocks' ANTHROPIC is listed beside the tokenized stock under the same rate, at a two-hundred percent haircut. The
> real token is Token-2022 with confidential transfers and a rebasing amount — the machinery this desk wraps — and a
> transfer hook, which is why it can't be a bonding-curve quote token.
>
> Which brings in Meteora. The desk's lender is an autonomous agent, so it has its own token on a bonding curve quoted
> in TSLAx, configured from the desk: the raise target is its lending capital through the same Pyth read, the fee
> decays over one loan tenor. We ran the whole lifecycle on devnet first — filled the curve, built the migration
> instruction the SDK doesn't expose, graduated into DAMM v2 with the liquidity locked — then launched on mainnet.
>
> And a correction worth telling: we wanted the agent's Clawpump wallet to be the pool's creator, and it can't be —
> Meteora makes the creator a signer, and that key belongs to Clawpump. So the launch key signs and takes zero, the
> agent's wallet is the fee claimer, and the dashboard checks that against the chain instead of asserting it."

---

## §9 · 8:30–9:03 — limits and what's next

**Screen:** the roadmap frame.

> "The honest limits. The administrator can decrypt individual amounts — accountable privacy, not anonymity. Devnet
> collateral is mock twins. Escrow sits in the operator's account because a program address can't make
> confidential-transfer proofs. One key plays four roles. Depth comes from labelled simulated agents. Unaudited.
>
> Next: real xStocks wrapping, a proof binding the funding transfer to the loan, and splitting the auditor key — none
> of which change the mechanism you just saw. Then mainnet, after an audit.
>
> The rate is public. The price is public. The position never was."

---

## Checks before you record

- Say **1.02 million compute units** for the seventy-four-tick worst case. `ADR-001` quotes an older figure from
  before the size-optimised build; `docs/measurements.json` and the README are current.
- The re-verify stepper has **six** stages.
- The Build page renders **eleven read recipes and ten write recipes**.
- The lender agent's pool and identity coin are on **mainnet**; the desk itself is on devnet.
- Both code snippets are verbatim from the files cited — re-read them if those programs change.
