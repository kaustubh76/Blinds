# Headless drivers for the hosted dashboard

`pnpm install` at the root installs `puppeteer-core`; Chrome for Testing comes from
`npx @puppeteer/browsers install chrome@stable` (once; it lands in `~/.cache/puppeteer`).

| driver | what it proves |
|---|---|
| `node routes.mjs <base>` | every route renders with no page errors, no 4xx/5xx (429 excluded), no stray `undefined` |
| `node recipes.mjs <base>#/build` | every wallet-free Build recipe runs to `[confirmed]` |
| `PROFILE=/tmp/judge node demo.mjs "<base>?admin=<faucet>" [listingKey]` | fresh burner → Autopilot → sealed bid |
| `PROFILE=/tmp/judge node positions.mjs "<base>?admin=<faucet>"` | after the print: derive, lock, deposit |
| `node shot.mjs <url> <out.png> [ms] [js]` | a screenshot and an evaluated expression |
| `node screens.mjs [base] [out-dir]` | re-takes `docs/screens/*.png`: five pages light + dark, the Home phone, the lender agent's card |
| `node png.mjs in.svg out.png [size]` | rasterises an SVG (token images for launch venues) |

`RESOLVE="host ip"` maps a fresh trycloudflare name past a stale local resolver.
