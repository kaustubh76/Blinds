# THE WINDOW for Stocks

**A private margin desk for tokenized stocks on Solana, printing xONIA — the first on-chain overnight borrow rate for tokenized equities.**

> The rate is public. The price is public. The position never was.

Live on devnet: <https://kaustubh76.github.io/Blinds/>

## The problem

In TradFi, securities lending works *because* it is private: nobody sees your size. On a transparent chain every position is public — front-run, copied, liquidated by spectators. So tokenized stocks have no borrow market and no benchmark rate.

## What we built

Holders wrap xStocks-style Token-2022 collateral into confidential balances and borrow USDC through a **sealed-bid, uniform-price auction**. Side and rate tick are public; **sizes are encrypted**. An on-chain program sums the ciphertexts homomorphically — 74 totals, 2 sides × 37 rate ticks — without ever decrypting a bid.

At each window's close the administrator, holding the auditor key, decrypts only the **totals** and must **prove every published number** with Solana's native ZK ElGamal proofs. The oracle program then **recomputes the clearing rate itself**: a valid proof paired with a wrong rate is rejected. That rate is xONIA.

Collateral solvency is one homomorphic statement the program builds itself:

```
E_Δ = (price × multiplier) · E_collateral − haircut · E_loan ≥ 0
```

proven against the public Pyth price with the **corporate-action multiplier inside the check** — a 10:1 split can neither fake nor destroy coverage — while neither the position nor the loan is revealed. No fresh price ⇒ no lock, no seizure. No custom circuits, no trusted setup.

**The administrator can decrypt individual amounts, and we say so.** What it cannot do is lie: every aggregate carries a proof, the rate is recomputed on chain, and anyone can re-verify a whole print in their browser from raw account data.

## What is live

- **Five Anchor programs on devnet**, printing autonomously every ~7 minutes.
- **A dashboard** on GitHub Pages: a burner wallet (no extension), a guided path plus an autopilot that borrows in ~20 seconds, an explorer that re-proves any print locally, and developer pages that run real SDK calls in the tab.
- **Two collaterals under one rate**: TSLAx (Pyth, 150 % haircut) and ANTHROPIC (PreStocks, 200 %).
- **A mainnet Meteora DBC pool** for the lender agent, quoted in real TSLAx.
- **Tests**: 32 attack cases plus e2e, invariant, privacy and measurement suites on Solana's real runtime, and a second tier against a real validator. A leak audit scans every account, transaction and log for secrets in plaintext.

## Track integrations

**Pyth** — not a widget: its price is a *coefficient inside the proof* and the gate on every seizure. The keeper stores the quote's own `publish_time`, so the chain — not the keeper — decides whether it is usable; a listing can cut the keeper out entirely and read Pyth's receiver-owned `PriceUpdateV2` directly. When the wrapper feed's only push account went quiet on 12 Sep we said so and priced from the underlying equity feed, rather than letting a stale number pass as fresh.

**PreStocks** — ANTHROPIC, the only pre-IPO token on the desk, listed beside a tokenized stock under one rate: wrap, prove `collateral ≥ 200 % × loan` against PreStocks' mark without revealing the position, borrow at the print. One card shows the mark as the chain holds it, the traded price and the basis between them, both freshness rules with the verdict the chain would give right now, and the real mainnet token read in your own browser.

**Meteora DBC** — the desk's lender agent is autonomous: it lends every window and earns xONIA. Its token **WLEND** launched on a Dynamic Bonding Curve **quoted in TSLAx**, configured from the desk's own numbers: the raise target is the agent's lending capital converted through the same Pyth read, the fee decays over one tenor of the desk, graduated liquidity locked for good. We ran the **entire lifecycle on devnet first** (curve filled, migrated to DAMM v2, positions locked), then launched on mainnet behind a preflight checking balance, quote age, decimals, the token badge and the DAMM v2 config.

**Clawpump** — the agent has a Clawpump identity and wallet, and it is *running*; the dashboard shows what Clawpump's API reports, not what we hoped. That wallet is the fee claimer of the Meteora pool, so trading fees, the raise share and the lending yield flow to one address a judge can watch.

## Honest limits

Devnet twins, not mainnet tokens. One disclosed key plays administrator, keeper, operator and price poster. Escrow sits in the operator's confidential account, because a program address cannot produce confidential-transfer proofs. Funding and repayment magnitudes are attested, not proven. Auction depth comes from labelled simulated agents. xONIA is a devnet reference rate, not a regulated benchmark. Unaudited — never custody real value.

More: `docs/SPEC.md` · `docs/TRACKS.md` · `docs/THREAT_MODEL.md` · `docs/project.excalidraw` (the whole product on one canvas).
