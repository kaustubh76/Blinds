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
hosted = app_url.read_text().strip() if app_url.exists() else ""

section = f"""## C. Devnet — the deployment that is judged

Everything below is live on devnet and readable by anyone; no account of ours is needed to check it.

| | address |
|---|---|
| registry | [`{progs['window_registry']}`]({ex(progs['window_registry'])}) |
| auction | [`{progs['window_auction']}`]({ex(progs['window_auction'])}) |
| oracle | [`{progs['window_oracle']}`]({ex(progs['window_oracle'])}) |
| wrap | [`{progs['window_wrap']}`]({ex(progs['window_wrap'])}) |
| credit | [`{progs['window_credit']}`]({ex(progs['window_credit'])}) |
| mock xStock mint (`ScaledUiAmount`) | [`{d['mock_mint']}`]({ex(d['mock_mint'])}) |
| cSTOCK-W mint (confidential, auditor key) | [`{d['cstock_mint']}`]({ex(d['cstock_mint'])}) |
| operator escrow (confidential account) | [`{d['escrow_account']}`]({ex(d['escrow_account'])}) |
| price feed | Pyth `Crypto.TSLAX/USD` `0x{d['feed_id_hex']}`, read from mainnet account [`GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY`](https://explorer.solana.com/address/GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY) |

Profile `config/devnet.toml`: ~7-minute epochs, 150 % haircut, `attest_batch = 4`. The
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

Market, Explorer and Positions read the chain directly, so they work with no service of ours
running. The Desk's *Join* button is a demo faucet served by the admin service: it registers your
wallet as a member, mints you 10,000 mock shares and sends 0.1 SOL for fees. It needs
`VITE_ADMIN_URL` pointing at a reachable admin service; the UI says so when it is not.

### Running the market yourself

```bash
WINDOW_AUDITOR_SEED_HEX=<64 hex> ./scripts/deploy_devnet.sh   # preflight, resumable
WINDOW_CLUSTER=devnet ./target/release/window-admin run &     # administrator + keeper + operator + price
WINDOW_CLUSTER=devnet ./target/release/window-admin agents &  # the simulated members
```

Cost, measured: every epoch permanently locks ~0.0362 SOL of rent (`Epoch` 0.0266 + `Print` 0.0041 +
~2 `Loan` at 0.0028), so the market burns ~0.33 SOL/hour. Bid rent comes back through the
permissionless `close_bid` the keeper runs.
"""

demo = (root / "docs" / "DEMO.md").read_text()
start = demo.index("## C. Devnet")
end = demo.index("## What to look at")
(root / "docs" / "DEMO.md").write_text(demo[:start] + section + "\n" + demo[end:])
print("docs/DEMO.md §C updated")
