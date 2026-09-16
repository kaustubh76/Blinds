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

## C. Devnet — the deployment that is judged

Everything below is live on devnet and readable by anyone; no account of ours is needed to check it.

| | address |
|---|---|
| registry | [`3Q49UcynVxvbrV9zw4M9bkMKrsQ2x6YvHtY1tgAjgKpi`](https://explorer.solana.com/address/3Q49UcynVxvbrV9zw4M9bkMKrsQ2x6YvHtY1tgAjgKpi?cluster=devnet) |
| auction | [`HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6`](https://explorer.solana.com/address/HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6?cluster=devnet) |
| oracle | [`78Z5vNDsujWjDZjKFp625tZ1QMjD44VEHKCFH3LmzfLV`](https://explorer.solana.com/address/78Z5vNDsujWjDZjKFp625tZ1QMjD44VEHKCFH3LmzfLV?cluster=devnet) |
| wrap | [`E2scxVy7CpoxWQRBXsrSteYBbuEeMu7Q4zXYMM5bvLX3`](https://explorer.solana.com/address/E2scxVy7CpoxWQRBXsrSteYBbuEeMu7Q4zXYMM5bvLX3?cluster=devnet) |
| credit | [`3C6zwULWtL7oQHcEQbL9myG2zaJ8CPanRvPrF18ifKcr`](https://explorer.solana.com/address/3C6zwULWtL7oQHcEQbL9myG2zaJ8CPanRvPrF18ifKcr?cluster=devnet) |
| mock xStock mint (`ScaledUiAmount`) | [`HspLRQqDkAjw2Dt6inJS6GrBHhuNfgHWtYtH9mMTzJpn`](https://explorer.solana.com/address/HspLRQqDkAjw2Dt6inJS6GrBHhuNfgHWtYtH9mMTzJpn?cluster=devnet) |
| cSTOCK-W mint (confidential, auditor key) | [`4qEY9zPJEw2W4Pr1CbUoYPYdSGBMXcfVccogDtaFHCQr`](https://explorer.solana.com/address/4qEY9zPJEw2W4Pr1CbUoYPYdSGBMXcfVccogDtaFHCQr?cluster=devnet) |
| operator escrow (confidential account) | [`BZ66pSmZ86D8pUPNDfn6SnQQ74P9FRbaY1tz6DXwv7FQ`](https://explorer.solana.com/address/BZ66pSmZ86D8pUPNDfn6SnQQ74P9FRbaY1tz6DXwv7FQ?cluster=devnet) |
| price feed | Pyth `Crypto.TSLAX/USD` `0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362`, read from mainnet account [`GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY`](https://explorer.solana.com/address/GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY) |

Profile `config/devnet.toml`: ~7-minute epochs, 150 % haircut, `attest_batch = 4`. The
6 simulated members are labelled `simulated` in `deployments/devnet.json` — they are
ours, and the depth they provide is not organic demand.

### Watch it yourself

```bash
# the next print, re-verified from chain data alone (no trust in us, no admin service)
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm watch:epoch --epochs 1

# the attacker script: scan every transaction, log and program account for a plaintext size
pnpm leak-audit --cluster devnet
```

### The dashboard

Run it locally (see below); a hosted URL is published in `deployments/app-url.txt` when it is up.

```bash
cd app && VITE_CLUSTER=devnet VITE_RPC_URL=https://api.devnet.solana.com pnpm dev
```

Market, Explorer and Positions read the chain directly, so they work with no service of ours
running. The Desk's *Join* button is a demo faucet served by the admin service: it registers your
wallet as a member, mints you 10,000 mock shares and sends 0.1 SOL for fees. It needs
`VITE_ADMIN_URL` pointing at a reachable admin service; the UI says so when it is not.

### Running the market yourself

```bash
WINDOW_AUDITOR_SEED_HEX=<64 hex> ./scripts/deploy_devnet.sh   # first time only: preflight, resumable
./scripts/market.sh start                                      # administrator + keeper + operator + agents
./scripts/market.sh status                                     # counters and how many hours of runway are left
./scripts/market.sh stop
```

**The market is run in windows, not continuously, and that is a budget decision rather than a
limitation of the design.** Measured on this deployment: **0.032 SOL per epoch**, all of it rent for
accounts that are deliberately never closed — `Epoch` (0.0266) holds the 74 accumulators that make a
print re-verifiable years later, `Print` (0.0041) holds the proven sums, and each `Loan` (0.0028)
holds its ciphertexts. Bid rent comes back through the permissionless `close_bid` the keeper runs.
At ~7-minute epochs that is ~0.28 SOL/hour, so a devnet balance of N SOL buys roughly 3.5·N hours of
live market. Every print already made stays on chain and stays verifiable while the market is
paused, which is why the series and the explorer are populated even between runs.

## What to look at

- A bid transaction: the instruction data holds a 320-byte validity proof and no number.
- The Epoch account: 74 × 96 bytes of accumulators, no sizes.
- An attest transaction: four `VerifyZeroCiphertext` instructions (1,182 bytes total) followed by
  `attest_ticks` with four `(side, tick, sum)` claims.
- A loan: `size_ct`, `collateral_ct`, `delta_commitment` — ciphertexts and a commitment;
  `price_at_lock`, `k_c`, `k_l` public.
