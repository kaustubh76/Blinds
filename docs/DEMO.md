# Demo walkthrough

Two ways to see the desk run: locally in one command, or on devnet with a browser wallet.

## A. Localnet, one command (≈ 3 minutes)

```bash
make build                          # anchor build → target/deploy/*.so, IDLs frozen into sdk/idl
pnpm install && ./scripts/build_wasm.sh && pnpm -r build   # SDK (with the browser proofs) + dashboard
make test-integration               # real solana-test-validator + real admin service + agents,
                                    # driven through the TS SDK: 8 tests, one full lifecycle
```

What the suite does, in the dashboard's own code path: two fresh wallets join, configure
confidential accounts (pubkey-validity proof), wrap 1,000 shares, submit encrypted bids (lender at
1.00 %, borrower at 10.00 %), the keeper closes the epoch, the administrator prints with PoCD proofs,
the print is re-verified from chain data in wasm, the borrower's bid becomes a loan, the borrower
locks collateral with the priced solvency proof, transfers it confidentially to escrow in the same
transaction as `deposit_collateral`, the operator confirms, funding and repayment are attested and
the collateral comes back. Finally an RPC leak audit checks every transaction, log and program
account for the plaintext sizes.

## B. Dashboard against localnet

```bash
WINDOW_PROFILE=demo ./scripts/localnet.sh up &      # validator + setup (6 simulated agents)
./target/release/window-admin run &                  # administrator + keeper + operator + price poster (:9090)
./target/release/window-admin agents &               # simulated members
cd app && cp .env.example .env && pnpm dev           # http://localhost:5173
```

The wallet must expose a `solana:localnet` account (Phantom and Solflare do). Tabs:

1. **Market** — xONIA (last r\*), regime flags, epoch countdown, the series, the last proven curve.
2. **Explorer** — pick an epoch: the 74 accumulator ciphertexts next to the 74 proven sums; click
   *Re-verify locally* to re-run the PoCD verifier in your browser on the raw accounts and attest
   transactions.
3. **Desk** — *Derive keys* (two wallet signatures; nothing leaves the tab) → *Join the desk* (the
   admin registers the key, mints 10,000 mock shares and sends 0.1 SOL for fees) → *Set up
   confidential account* → *Wrap* → *Submit encrypted bid*. Every transaction of a plan is listed
   with its signature.
4. **Positions** — loans as borrower/lender (sizes render as ciphertexts), bids on-chain, and for a
   `Pending` loan the *Lock collateral* → *Deposit to escrow* buttons.

## C. Devnet

Program ids are fixed (`Anchor.toml`); `deployments/devnet.json` is written by
`scripts/deploy_devnet.sh` (needs ≈ 10 SOL on the deployer and `WINDOW_AUDITOR_SEED_HEX`). Then:

```bash
WINDOW_CLUSTER=devnet ./target/release/window-admin run &
WINDOW_CLUSTER=devnet ./target/release/window-admin agents &
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm tsx scripts/watch_epoch.ts --epochs 1
cd app && VITE_CLUSTER=devnet VITE_RPC_URL=https://api.devnet.solana.com VITE_ADMIN_URL=http://<admin-host>:9090 pnpm dev
```

`watch_epoch.ts` waits for the next print, re-verifies it and reports the attest transaction count
and wall-clock. Judges use the same Desk flow as above with a devnet wallet; the admin's `/join`
endpoint is the faucet.

## What to look at

- A bid transaction: the instruction data holds a 320-byte validity proof and no number.
- The Epoch account: 74 × 96 bytes of accumulators, no sizes.
- An attest transaction: four `VerifyZeroCiphertext` instructions (1,182 bytes total) followed by
  `attest_ticks` with four `(side, tick, sum)` claims.
- A loan: `size_ct`, `collateral_ct`, `delta_commitment` — ciphertexts and a commitment;
  `price_at_lock`, `k_c`, `k_l` public.
