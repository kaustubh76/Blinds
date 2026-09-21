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

A quick tunnel does not survive a long network outage: the `cloudflared` process stays up while the link is
dead, `status` shows `(unreachable)` and the hosted Desk says the faucet is offline. `./scripts/market.sh tunnel`
replaces it (new URL, `admin-url.txt` rewritten) without restarting the market.

If GitHub Pages is unavailable (see §5): `./scripts/serve_app.sh start` serves the built dashboard from this
machine through its own tunnel and prints `<url>/?admin=<faucet>`; that URL rotates per start, and it dies
the same way — check it before sharing.

For a judging window longer than a coffee: `./scripts/watch_tunnels.sh start` probes both tunnels every
minute (through 1.1.1.1, past the local resolver's cache), replaces a dead one (`market.sh tunnel`,
`serve_app.sh` restart), re-copies the faucet pointer into the served build (`serve_app.sh refresh`) and logs
the current share link to `/tmp/window-tunnels.log`; `WINDOW_PUBLISH=1` also commits the pointer for the
Pages site. Start it with the same `WINDOW_APP_DIST` you gave `serve_app.sh`, if any.

### 2a. The Pyth listing on Pyth's own account (Stage 4, needs `PYTH_API_KEY` in `.env`)

With the key present, `market.sh start` also launches `services/pyth-poster` (`pnpm install` once), which
posts Pyth's signed `Crypto.TSLAX/USD` update into the Pyth receiver on devnet every minute
(`/tmp/window-pyth-poster-devnet.log`; ≈ 0.00001 SOL per post, ≈ 0.002 SOL rent once). Then, one time:

```bash
./target/release/window-admin --cluster devnet --profile devnet price-check   # "on-cluster Pyth account JBDgVnqW… age N s"
./target/release/window-admin --cluster devnet --profile devnet listing-set-source mock_tsla 4   # refuses while the account is stale
python3 scripts/render_devnet_docs.py                                # DEMO §C names the new source
git add deployments/devnet.json docs/DEMO.md && git commit -m "devnet: TSLAx reads Pyth's account"
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
| a mark listing stops posting; `warn … re-posting last good` | PreStocks API down | nothing for 6 h (last-good is re-posted); after 48 h the chain halts that listing's locks |
| faucet answers `429 busy` / `503 paused` | hourly cap (30) / balance floor (0.5 SOL) | wait, or top up |
| judge's Join fails with a token-account error | the dashboard was built before 2026-09-18 | reload (the faucet now derives listing #0's account itself) |
| agents log `transfer proofs: … InconsistentInput` or a loan sits `Requested` (locked, never deposited) | the account's AE "decryptable" balance cache disagreed with its ElGamal balance (a stale ApplyPendingBalance), or the deposit failed after the lock | since 2026-09-20 the agents resync the cache from the ElGamal balance and resume the deposit under the loan's own listing on the next pass — nothing to do; if it persists, `WINDOW_AGENTS_LOG` shows the cause after the dash |
| a judge's bid prints `no trade` and no loan appears | the agents did not quote in that window (before 2026-09-19 their loan service could outlast a window on the public RPC), or the bid sat exactly at the print | agents quote in every window now (`bid submitted … epoch=N` for all six in `/tmp/window-agents-devnet.log`); the Autopilot bids 50 bp past the last print; bid again in the next window |
| Positions shows the loan but the lock button is disabled | the tab has no member signature (they never persist) | "Sign to derive" on Positions — one signature |
| `make test-integration` fails at `setup` on a Linux x86_64 machine with `VerifyPubkeyValidity → SigmaProof(PubkeyValidity, AlgebraicRelation)` | the **prebuilt** Agave `solana-test-validator` for Linux x86_64 (4.2.1, 4.2.2 and 4.3.0 from release.anza.xyz; AMD Zen 3 and Zen 4 runners alike) refuses pubkey-validity proofs that the macOS arm64 build of the same commit, LiteSVM compiled on that same Linux machine, and devnet's own validators all accept — shown by `window-admin zk-probe`, which sends two proof-only transactions (this binary's proof and one made on macOS): both refused there, both accepted here. Same feature set, same version string, same bytes. Not this project's code | run `WINDOW_PROFILE=integration ./scripts/localnet.sh probe` to confirm on the machine, then run tier 2 on macOS or against devnet; `.github/workflows/tier2.yml` can build the validator from source (`build_validator=true`) |
| hosted site 404 / Actions "not started … payments have failed" | GitHub billing hold on the account (suspends Actions **and** Pages, even for public repos) | github.com/settings/billing → fix the payment; then `gh api -X POST repos/kaustubh76/Blinds/pages -f build_type=workflow` and re-run the `pages` workflow; meanwhile `serve_app.sh` |
| browser 429s on `api.devnet.solana.com` | admin + agents + browsers share one IP | a dedicated devnet RPC in Settings (`?rpc=`), or the repo variable `VITE_RPC_URL` |

## 6. The lender agent's token (services/launch)

The desk's lender is an autonomous agent; its token `WLEND` lives on a Meteora Dynamic Bonding Curve quoted in
a tokenized stock (`docs/TRACKS.md` Part B). One CLI, one record per cluster (`deployments/launch-<cluster>.json`):

```sh
pnpm install && pnpm --filter @thewindow/solana-sdk build            # once
export LAUNCH_CLUSTER=devnet                                          # or mainnet
pnpm --filter @thewindow/launch plan               # Pyth-priced curve → deployments/launch-plan-<cluster>.json (no tx)
pnpm --filter @thewindow/launch launch             # createConfigAndPool: the pool mints WLEND; ~0.03 SOL + rents
pnpm --filter @thewindow/launch status             # progress, raised vs threshold (quote and USD), spot, fees
pnpm --filter @thewindow/launch buy 5              # devnet only: swap 5 twin-quote into WLEND to move the curve
pnpm --filter @thewindow/launch graduate           # once the threshold is met: migrate to DAMM v2, LP locked
CLAWPUMP_API_KEY=cpk_… pnpm --filter @thewindow/launch agent   # the lender's Clawpump identity + wallet
```

- **Which price.** The plan is priced from Pyth's own mainnet account for `Crypto.TSLAX/USD`; when that account
  is older than a day (its only push account died on 12 Sep) the underlying `Equity.US.TSLA/USD` prices it and
  the record says so (`quote.feed`). A mainnet launch refuses a quote older than 3 days.
- **Mainnet.** `WINDOW_LAUNCH_KEYPAIR` must hold ~0.5 SOL; the quote is TSLAx
  (`XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`, Meteora-badged). Set `LAUNCH_CREATOR` to the Clawpump agent
  wallet first (run `agent`), or the payer becomes the fee wallet. The dashboard prefers
  `deployments/launch-mainnet.json` the moment it exists (`app/src/lib/launch.ts`); commit it and re-render
  `docs/DEMO.md`.
- **Devnet.** The quote is a plain 8-dp twin mint the tool creates and funds (1,000 units to the payer);
  `LAUNCH_NEW_QUOTE=1` mints a fresh one. The pool is a rehearsal — same program, same config, same code path.
- Nothing here touches the desk's programs, the keeper or the market; it can run while the market is stopped.

## 7. The last action: freeze

`./scripts/freeze.sh` sets every program's upgrade authority to none — **irreversible**. Only after the
final program change is on devnet and verified; then `git tag -a v1.0.0-stocklana`.
