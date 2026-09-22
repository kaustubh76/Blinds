# What the deploy copies into `app/dist`

`scripts/deploy_vercel.sh` publishes the built dashboard as a static site and drops these in beside it.

| file | why |
|---|---|
| `api/rpc.mjs` | Same-origin JSON-RPC proxy. The public devnet endpoint limits per client IP and the desk's own services spend that quota from the machine running the market, so a browser there lost ~45 % of its reads to HTTP 429. The function forwards from Vercel's egress, retries the rest and holds read replies for `RPC_CACHE_MS`. `RPC_UPSTREAM` points it at a dedicated endpoint, key server-side. |
| `vercel.json` | Cache headers. `/assets/*` filenames carry a content hash, so they are immutable and cached for a year. `index.html` names those hashes: a stale copy asks for files a newer deploy deleted, which renders a blank page — so it is `no-store`. `admin-url.txt` changes whenever the faucet tunnel rotates. |
| `admin-url.txt` | The faucet pointer (`deployments/admin-url.txt`), read at runtime. |
