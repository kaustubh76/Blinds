# Headless drivers for the hosted dashboard

`pnpm install` at the root installs `puppeteer-core`; Chrome for Testing comes from
`npx @puppeteer/browsers install chrome@stable` (once; it lands in `~/.cache/puppeteer`).

| driver | what it proves |
|---|---|
| `node routes.mjs <base>` | every route renders with no page errors, no 4xx/5xx (429 excluded), no stray `undefined` |
| `node recipes.mjs <base>#/build` | every wallet-free Build recipe runs to `[confirmed]`. It drives the nine read recipes by `[data-recipe="<id>"]` and a button labelled *run here* — those ids and that label are a contract; the write recipes are gated and skipped |
| `node interactive.mjs <base>` | what a page load never reaches: the wallet menu opens on a phone without falling off the edge, announces itself as a menu, holds the full address, and disconnects without crashing; the motion preference applies with no reload; four navigations print one chain line, not one per mounted clock; a Build recipe's parameter changes the snippet on screen, the wire inspector records the JSON-RPC and renders it as `curl`, the scratchpad runs, and nothing that writes is reachable without a key; the Agent page lists the simulated members, names each journey step's command, never links to itself, and unlocks the agents' strategy — with a dial moving the anchor it quotes around — once there is a key |
| `PROFILE=/tmp/judge node demo.mjs "<base>?admin=<faucet>" [listingKey]` | fresh burner → Autopilot → sealed bid |
| `PROFILE=/tmp/judge node positions.mjs "<base>?admin=<faucet>"` | after the print: derive, lock, deposit |
| `node shot.mjs <url> <out.png> [ms] [js]` | a screenshot and an evaluated expression |
| `node screens.mjs [base] [out-dir]` | re-takes `docs/screens/*.png`: five pages light + dark, the Home phone, the lender agent's card. Passes `motion=off`, so the backdrop is held still and a re-take differs only where the page did |
| `node png.mjs in.svg out.png [size]` | rasterises an SVG (token images for launch venues) |

`RESOLVE="host ip"` maps a fresh trycloudflare name past a stale local resolver.
