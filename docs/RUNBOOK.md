# Judging-day runbook

What to run, in order, so a judge sees a live market with a working faucet; what each step costs;
what to do when something fails. Everything is on devnet; the deployer key is `~/.config/solana/id.json`
(`8S6dkUV5uby7raYz9aoqHBLDdCL3LvSikyYR5BjkwHf5`); `.env` holds the auditor seed.

```bash
export PATH="/opt/homebrew/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/Library/pnpm:$PATH"
cd ~/Desktop/Blinds
```

## 1. Budget

| what | cost |
|---|---|
| the market (keeper + administrator + operator + agents) | **~0.28 SOL / hour** — 0.032 SOL per ~7-minute epoch, all rent for accounts kept on chain |
| the faucet, per new wallet | 0.10 SOL + two token accounts (~0.006) |
| a judge's full flow (bid, lock, deposit) | < 0.05 SOL, paid from the faucet's 0.10 |

`solana balance -ud` — have **≥ 1 SOL** for a two-hour window plus a handful of judges. `solana airdrop 2 -ud`
is usually rate-limited; <https://faucet.solana.com> (GitHub login) gives 5 SOL. The market at 0.01 SOL
fails every transaction and burns nothing — but shows nothing either.

## 2. Start

```bash
./scripts/market.sh start        # keeper, administrator, operator, agents; opens the faucet tunnel
#   prints:  faucet  https://<x>.trycloudflare.com
#            share   https://kaustubh76.github.io/Blinds/?admin=https://<x>.trycloudflare.com
./scripts/market.sh status       # counters, faucet health + remaining joins, hours of runway
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule     # every listing usable within one tick
```

Give judges the **share link** (it configures the faucet in their browser once). The tunnel URL is new
on every `start`; a browser that saved an older one probes it, fails within 4 s and falls back to
read-only — send the fresh link (or `publish_admin_url.sh`). Optionally
`./scripts/publish_admin_url.sh` commits the pointer so the hosted app finds the faucet without the link
(Pages redeploys in ~2 min; its edge cache can lag ~10 min).

If GitHub Pages is unavailable (see §5): `./scripts/serve_app.sh start` serves the built dashboard from this
machine through its own tunnel and prints `<url>/?admin=<faucet>`; that URL rotates per start.

### 2a. The Pyth listing on Pyth's own account (Stage 4, needs `PYTH_API_KEY` in `.env`)

With the key present, `market.sh start` also launches `services/pyth-poster` (`pnpm install` once), which
posts Pyth's signed `Crypto.TSLAX/USD` update into the Pyth receiver on devnet every minute
(`/tmp/window-pyth-poster-devnet.log`; ≈ 0.00001 SOL per post, ≈ 0.002 SOL rent once). Then, one time:

```bash
./scripts/upgrade_devnet.sh                                          # if window_credit is older than A15 (solana program show … slot)
./target/release/window-admin --cluster devnet --profile devnet price-check   # "on-cluster Pyth account JBDgVnqW… age N s"
./target/release/window-admin --cluster devnet --profile devnet listing-set-source mock_tsla 4   # refuses while the account is stale
git add deployments/devnet.json && git commit -m "devnet: TSLAx reads Pyth's account"
```

From then on TSLAx locks and seizures are priced from the receiver-owned account and the keeper posts no cache
for it. To go back (poster down for longer than an hour): `listing-set-source mock_tsla 0` — the cache path
resumes on the next keeper tick.

## 3. Watch

```bash
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm watch:epoch --epochs 1   # next print, re-verified in wasm
./target/release/window-admin --cluster devnet --profile devnet price-check # every listing's source, mark, quote age
curl -s 127.0.0.1:9090/metrics | grep -E 'price_publish_age|prices_posted|prints_total'
tail -f /tmp/window-admin-devnet.log
```

## 4. Stop

```bash
./scripts/market.sh stop         # closes the tunnel, clears deployments/admin-url.txt (publish that too if you published the URL)
./scripts/serve_app.sh stop      # if the fallback link was up
```

Every print, loan and listing stays on chain and verifiable while the market is paused.

## 5. When it fails

| symptom | cause | do |
|---|---|---|
| `send_and_confirm … custom program error: 0`, `insufficient funds` in the admin log | deployer out of SOL | top up (§1), `market.sh stop` then `start` |
| poster log says `post failed … 403 Not entitled` | the key is not entitled to `Crypto.TSLAX/USD` (Pyth Pro tier) | `listing-set-source mock_tsla 0` if it was flipped; the keeper's Hermes/on-chain path needs the same entitlement, so TSLAx stays refused by design |
| `[TSLAx-mock] … age 137.4 h (limit 3600 s)`, schedule says `QuoteStale` | no `PYTH_API_KEY`: every Pyth HTTP API is keyed since 2026-08-26 and the only on-chain push account for `Crypto.TSLAX/USD` (shard 0) stopped on 12 Sep | get a Pyth key into `.env` (`PYTH_API_KEY=`), restart; without one the chain refuses TSLAx locks by design (inaction, never a stale mark) — the two mark listings still lock |
| `no readable Pyth account`, 429 from `api.mainnet-beta` | public mainnet RPC rate limit | `WINDOW_PRICE_RPC_URL=https://solana-rpc.publicnode.com` in `.env`, restart |
| epochs print `no trade` although agents run; the agents log shows bids from two agents only | (fixed 18 Sep) the loan service used to run between agents' bids and outlast the window; the two-pass tick lets all six quote first | update the binary: `cargo build -p window-admin --release`, then `market.sh stop && start` |
| `release failed: destination has no cSTOCK-W account … (retrying quietly)` once per loan | the payee holds no confidential account on the loan listing's cSTOCK mint (a lender on another listing) | agents: `window-admin listings-sync` creates them; a judge's wallet: Positions shows *Receive the payout · set up a … account* on the defaulted loan (two transactions) — the operator releases on its next tick |
| a mark listing stops posting; `warn … re-posting last good` | Tessera / PreStocks API down | nothing for 6 h (last-good is re-posted); after 48 h the chain halts that listing's locks |
| faucet answers `429 busy` / `503 paused` | hourly cap (30) / balance floor (0.5 SOL) | wait, or top up |
| judge's Join fails with a token-account error | the dashboard was built before 2026-09-18 | reload (the faucet now derives listing #0's account itself) |
| hosted site 404 / Actions "not started … payments have failed" | GitHub billing hold on the account (suspends Actions **and** Pages, even for public repos) | github.com/settings/billing → fix the payment; then `gh api -X POST repos/kaustubh76/Blinds/pages -f build_type=workflow` and re-run the `pages` workflow; meanwhile `serve_app.sh` |
| browser 429s on `api.devnet.solana.com` | admin + agents + browsers share one IP | a dedicated devnet RPC in Settings (`?rpc=`), or the repo variable `VITE_RPC_URL` |

## 6. The last action: freeze

`./scripts/freeze.sh` sets every program's upgrade authority to none — **irreversible**. Only after the
final program change is on devnet and verified; then `git tag -a v1.0.0-stocklana`.
