# Demo walkthrough

Two ways to see the desk run: locally in one command, or on devnet with a browser wallet.

## A. Localnet, one command (≈ 3 minutes)

```bash
make build                          # anchor build → target/deploy/*.so, IDLs frozen into sdk/idl
pnpm install && ./scripts/build_wasm.sh && pnpm -r build   # SDK (with the browser proofs) + dashboard
make test-integration               # real solana-test-validator + real admin service + agents,
                                    # driven through the TS SDK: 15 tests, two full lifecycles + a split fill
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

The wallet must expose a `solana:localnet` account (Phantom and Solflare do). Four pages, keys 1–4:

1. **Market** — the hero xONIA figure with its sparkline, and *the window*: a ring that fills as the
   open epoch's slots elapse, then shows the print being proven tick by tick, then stamps the rate
   and keeps it until the next window opens. Below: the series (no-trade windows as hollow markers),
   the last proven curve, how-a-print-is-made tiles, and the public price with its feed's own
   timestamp.
2. **Explorer** (`#/explorer/<epoch>`, linkable) — the 74 accumulators as sealed ciphertexts next
   to the sums the print proved, the clearing rate row marked; *Re-verify in this browser* shows each
   stage of the work with its timing (fetch the accounts, find the attest transactions, extract the
   proofs, verify them in wasm, recompute r\*) and ends in a verdict that compares the printed rate
   with the recomputed one.
3. **Desk** — five steps that say why they are blocked: *Derive keys* (two wallet signatures;
   nothing leaves the tab) → *Join* (the demo faucet registers the key, mints 10,000 mock shares and
   sends 0.1 SOL) → *confidential account* → *Wrap* → *Seal and submit* a bid. Your own balances
   open in place, labelled "decrypted in this tab"; every transaction of a plan is listed with an
   explorer link.
4. **Positions** — loan cards with a lifecycle track (matched → solvency proven → collateral in
   escrow → locked → funded → repaid / defaulted), sizes and collateral sealed, and the one action
   that applies.

## C. Devnet — the deployment that is judged

Everything below is live on devnet and readable by anyone; no account of ours is needed to check it.

| | address |
|---|---|
| registry | [`3Q49UcynVxvbrV9zw4M9bkMKrsQ2x6YvHtY1tgAjgKpi`](https://explorer.solana.com/address/3Q49UcynVxvbrV9zw4M9bkMKrsQ2x6YvHtY1tgAjgKpi?cluster=devnet) |
| auction | [`HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6`](https://explorer.solana.com/address/HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6?cluster=devnet) |
| oracle | [`78Z5vNDsujWjDZjKFp625tZ1QMjD44VEHKCFH3LmzfLV`](https://explorer.solana.com/address/78Z5vNDsujWjDZjKFp625tZ1QMjD44VEHKCFH3LmzfLV?cluster=devnet) |
| wrap | [`E2scxVy7CpoxWQRBXsrSteYBbuEeMu7Q4zXYMM5bvLX3`](https://explorer.solana.com/address/E2scxVy7CpoxWQRBXsrSteYBbuEeMu7Q4zXYMM5bvLX3?cluster=devnet) |
| credit | [`3C6zwULWtL7oQHcEQbL9myG2zaJ8CPanRvPrF18ifKcr`](https://explorer.solana.com/address/3C6zwULWtL7oQHcEQbL9myG2zaJ8CPanRvPrF18ifKcr?cluster=devnet) |

**The collateral schedule** ([`docs/LISTINGS.md`](LISTINGS.md)): one xONIA rate, 3 eligible
collaterals, each a `Listing` with its own price source, haircut and two freshness limits that
`lock_collateral` and `seize` enforce on chain (the keeper must have posted within `max_price_age`
slots **and** the quote's own timestamp must be within `max_publish_age`).

| listing | account | price source | haircut | limits | mints · escrow |
|---|---|---|---|---|---|
| `TSLAx-mock` | [`5pJXoGpvFpJwPFUdyri22Kxv679UmhbRaaiLannC7zGG`](https://explorer.solana.com/address/5pJXoGpvFpJwPFUdyri22Kxv679UmhbRaaiLannC7zGG?cluster=devnet) | Pyth `Crypto.TSLAX/USD` — Hermes with `PYTH_API_KEY`, else Pyth's on-chain push account (shard 0 [`GpoWLTd6…`](https://explorer.solana.com/address/GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY), the only shard that exists for this feed); the quote's own `publish_time` | 150 % | 1 h quote · 1200 slots posted | mock [`HspL…zJpn`](https://explorer.solana.com/address/HspLRQqDkAjw2Dt6inJS6GrBHhuNfgHWtYtH9mMTzJpn?cluster=devnet) · cSTOCK-W [`4qEY…HCQr`](https://explorer.solana.com/address/4qEY9zPJEw2W4Pr1CbUoYPYdSGBMXcfVccogDtaFHCQr?cluster=devnet) · escrow [`BZ66…v7FQ`](https://explorer.solana.com/address/BZ66pSmZ86D8pUPNDfn6SnQQ74P9FRbaY1tz6DXwv7FQ?cluster=devnet) |
| `T-OpenAI-mock` | [`BAUiqwUUWTF2NDJqkSDz9so3BxNTW9hQS8Khf2qxqhYN`](https://explorer.solana.com/address/BAUiqwUUWTF2NDJqkSDz9so3BxNTW9hQS8Khf2qxqhYN?cluster=devnet) | Tessera public API `markPrice` (`T-OpenAI`, mint `oPAiAikW…`) — an attested mark: `publish_time` is the keeper's fetch time | 200 % | 48 h quote · 1200 slots posted | mock [`DVhT…o1Fz`](https://explorer.solana.com/address/DVhTynwmhm9hYNi7qAKtxpgPwCem9wEwXQonbf8Go1Fz?cluster=devnet) · cSTOCK-W [`GRDt…ZZhs`](https://explorer.solana.com/address/GRDt32Vp2BNEJPe1CFzSZaAFhCRw5bymWXH7tJrRZZhs?cluster=devnet) · escrow [`AmL9…TPp4`](https://explorer.solana.com/address/AmL991As2RWBmPojVvpokCYbB4bT1XbPbszPGpkYTPp4?cluster=devnet) |
| `ANTHROPIC-mock` | [`4qQ4A9mZu9AHkKRYtbYJN4rq6dd768gbE6F3UMtp6QTp`](https://explorer.solana.com/address/4qQ4A9mZu9AHkKRYtbYJN4rq6dd768gbE6F3UMtp6QTp?cluster=devnet) | PreStocks public API `markPrice` (`ANTHROPIC`, `Pren1FvF…`) — an attested mark: `publish_time` is the keeper's fetch time | 200 % | 48 h quote · 1200 slots posted | mock [`BA1w…ie7C`](https://explorer.solana.com/address/BA1wPNWjGfNam7ViKiM6C6tAGsQRjtQfRBjZGEYdie7C?cluster=devnet) · cSTOCK-W [`DA7U…8rNo`](https://explorer.solana.com/address/DA7UsQD5zwnVTyEcL1RVc5DsDDokfqx9a6AVSTaP8rNo?cluster=devnet) · escrow [`93my…jkZ9`](https://explorer.solana.com/address/93myeNeYyYzeVrDtW327UtmAiThYKfTxY7orWVvtjkZ9?cluster=devnet) |

The `-mock` mints are devnet twins (Token-2022 `ScaledUiAmount` + `PermanentDelegate`), wrapped 1:1
into a confidential mint under the desk's auditor key; no mainnet token is touched. `pnpm schedule`
prints what the chain would accept right now:

```bash
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule    # every listing: mark, quote age, posted age, lock accepted?
```

Profile `config/devnet.toml`: ~7-minute epochs, `attest_batch = 4`. The
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

Hosted: <https://kaustubh76.github.io/Blinds/> — if that answers 404 (GitHub Pages is tied to the account's billing state), the fallback is the link `./scripts/serve_app.sh status` prints on the operator's machine.

```bash
cd app && VITE_CLUSTER=devnet VITE_RPC_URL=https://api.devnet.solana.com pnpm dev
```

Market, Explorer, Positions and Build read the chain directly, so they work with no service of ours
running. The Desk's *Join* is a demo faucet served by the admin service: it registers your wallet
as a member, mints you 10,000 mock shares of every listed collateral and sends 0.1 SOL for fees —
once per wallet, at most 30 wallets an hour. While the market runs, `./scripts/market.sh start`
exposes it through a tunnel and prints a link of the form `https://kaustubh76.github.io/Blinds/?admin=https://<x>.trycloudflare.com`;
open the dashboard from that link (or paste the URL in Settings) and the Desk is live.

**No wallet extension needed.** On the Desk, *Create a devnet burner* makes a throwaway key in
your browser; pick a listing, and *Autopilot* runs derive → join → set up → wrap → bid in one click,
every transaction landing in the console (`` ` `` toggles it) as the SDK code that produced it. After
the next print, a bid at the clearing rate becomes a loan on *Positions*, where the borrower's lock
(against that listing's mark and haircut) and deposit (into that listing's escrow) run from the same
key. *Build* (key 5) has the recipes, the IDLs and the API for anyone who wants to integrate.

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
