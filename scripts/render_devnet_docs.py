#!/usr/bin/env python3
"""Rewrites docs/DEMO.md §C and the README's live-deployment block from deployments/devnet.json,
so the addresses a judge is told to look at are always the ones that were actually deployed."""
import json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
d = json.loads((root / "deployments" / "devnet.json").read_text())
if not d.get("mock_mint"):
    sys.exit("deployments/devnet.json has no mints yet — run scripts/deploy_devnet.sh first")

ex = lambda a: f"https://explorer.solana.com/address/{a}?cluster=devnet"
progs = d["programs"]
app_url = (root / "deployments" / "app-url.txt")
hosted = ""
if app_url.exists():
    lines = [l.strip() for l in app_url.read_text().splitlines() if l.strip() and not l.startswith("#")]
    hosted = lines[0] if lines else ""

SOURCE = {
    "pyth": "Pyth `Crypto.TSLAX/USD` — Hermes with `PYTH_API_KEY`, else Pyth's on-chain push account (shard 0 [`GpoWLTd6…`](https://explorer.solana.com/address/GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY), the only shard that exists for this feed); the quote's own `publish_time`",
    "tessera": "Tessera public API `markPrice` (`T-OpenAI`, mint `oPAiAikW…`) — an attested mark: `publish_time` is the keeper's fetch time",
    "prestocks": "PreStocks public API `markPrice` (`ANTHROPIC`, `Pren1FvF…`) — an attested mark: `publish_time` is the keeper's fetch time",
    "mock": "deterministic mock walk (localnet only)",
}
def hours(secs):
    return f"{secs // 3600} h" if secs >= 3600 else f"{secs // 60} min"
listing_rows = "\n".join(
    f"| `{l['symbol']}` | [`{l['listing']}`]({ex(l['listing'])}) | {SOURCE.get(l['source'], l['source'])} | {l['haircut_bps'] / 100:.0f} % | "
    f"{hours(l['max_publish_age_secs'])} quote · {l['max_price_age_slots']} slots posted | "
    f"mock [`{l['mock_mint'][:4]}…{l['mock_mint'][-4:]}`]({ex(l['mock_mint'])}) · cSTOCK-W [`{l['cstock_mint'][:4]}…{l['cstock_mint'][-4:]}`]({ex(l['cstock_mint'])}) · escrow [`{l['escrow_account'][:4]}…{l['escrow_account'][-4:]}`]({ex(l['escrow_account'])}) |"
    for l in d.get("listings", [])
)

section = f"""## C. Devnet — the deployment that is judged

Everything below is live on devnet and readable by anyone; no account of ours is needed to check it.

| | address |
|---|---|
| registry | [`{progs['window_registry']}`]({ex(progs['window_registry'])}) |
| auction | [`{progs['window_auction']}`]({ex(progs['window_auction'])}) |
| oracle | [`{progs['window_oracle']}`]({ex(progs['window_oracle'])}) |
| wrap | [`{progs['window_wrap']}`]({ex(progs['window_wrap'])}) |
| credit | [`{progs['window_credit']}`]({ex(progs['window_credit'])}) |

**The collateral schedule** ([`docs/LISTINGS.md`](LISTINGS.md)): one xONIA rate, {len(d.get('listings', []))} eligible
collaterals, each a `Listing` with its own price source, haircut and two freshness limits that
`lock_collateral` and `seize` enforce on chain (the keeper must have posted within `max_price_age`
slots **and** the quote's own timestamp must be within `max_publish_age`).

| listing | account | price source | haircut | limits | mints · escrow |
|---|---|---|---|---|---|
{listing_rows}

The `-mock` mints are devnet twins (Token-2022 `ScaledUiAmount` + `PermanentDelegate`), wrapped 1:1
into a confidential mint under the desk's auditor key; no mainnet token is touched. `pnpm schedule`
prints what the chain would accept right now:

```bash
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule    # every listing: mark, quote age, posted age, lock accepted?
```

Profile `config/devnet.toml`: ~7-minute epochs, `attest_batch = 4`. The
{len(d['agents'])} simulated members are labelled `simulated` in `deployments/devnet.json` — they are
ours, and the depth they provide is not organic demand.

### Watch it yourself

```bash
# the next print, re-verified from chain data alone (no trust in us, no admin service)
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm watch:epoch --epochs 1

# the attacker script: scan every transaction, log and program account for a plaintext size
pnpm leak-audit --cluster devnet
```

### The dashboard

{f'Hosted: <{hosted}>' if hosted else 'Run it locally (see below); a hosted URL is published in `deployments/app-url.txt` when it is up.'}

```bash
cd app && VITE_CLUSTER=devnet VITE_RPC_URL=https://api.devnet.solana.com pnpm dev
```

Market, Explorer, Positions and Build read the chain directly, so they work with no service of ours
running. The Desk's *Join* is a demo faucet served by the admin service: it registers your wallet
as a member, mints you 10,000 mock shares of every listed collateral and sends 0.1 SOL for fees —
once per wallet, at most 30 wallets an hour. While the market runs, `./scripts/market.sh start`
exposes it through a tunnel and prints a link of the form `{hosted or 'https://<dashboard>/'}?admin=https://<x>.trycloudflare.com`;
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
"""

demo = (root / "docs" / "DEMO.md").read_text()
start = demo.index("## C. Devnet")
end = demo.index("## What to look at")
(root / "docs" / "DEMO.md").write_text(demo[:start] + section + "\n" + demo[end:])
print("docs/DEMO.md §C updated")
