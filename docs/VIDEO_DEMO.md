# The 3-minute demo video

Word-for-word narration for a **recorded** video, with what is on screen at each beat. The live/booth version — with
fallbacks for a closed window and the questions judges ask — is [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md); addresses and the
long walkthrough are [`DEMO.md`](DEMO.md); the technical explainer is [`VIDEO_TECHNICAL.md`](VIDEO_TECHNICAL.md).

Figures written `‹screen›` change every window — read them off the page you recorded, never from here.

Total: **≈ 490 spoken words** — three minutes at 165 words per minute, which is a normal presenting pace. If you read
slower than that, take the cuts under "If you need to trim".

---

## Before you record

```bash
./scripts/judging_day.sh up      # market + tunnel + the ?admin=… share link, then it checks every route
./scripts/judging_day.sh status  # where the window is, what it is costing
```

1. **Use a dedicated devnet RPC.** `WINDOW_RPC_URL` for the services, `?rpc=<url>` for the browser. The public endpoint
   answers 429 when the keeper, the agents and a browser share one address — the single biggest cause of dead air.
2. **Start recording within a minute of a window opening.** A bid can only be sealed while one is open: about
   **8½ minutes of every ~15 minute cycle**. With a window open the autopilot reaches a confirmed bid in **~37 seconds**,
   which is exactly what the 1:00 narration covers.
3. Open the site from the printed `?admin=…` link and add **`&motion=off`** before the `#` — the field behind the page
   animates and makes a recording churn. Fresh incognito profile, zoom 110 %, ≥1130 device px so the pill nav shows,
   DevTools closed.
4. Check which listing the chain is accepting (`pnpm schedule`, or `judging_day.sh up` prints it) and pick that one on
   the Desk. The **refused** one is part of the story — see 0:30.
5. Cutaways: `docs/screens/` has 15 stills, light and dark. There is **no `build.png` or `positions.png`** — capture
   those live if you want them.

---

## The script

| time | on screen | say this |
|---|---|---|
| **0:00** | Home hero, the window ring turning | "Holders of tokenized stock can't borrow against it without showing the position — and on a public chain that means being front-run. So the asset sits idle. This is a private margin desk for tokenized stocks, on Solana devnet." |
| **0:12** | scroll to the collateral cards | "Borrow dollars overnight against tokenized shares. Every few minutes the market clears at **one** rate — this number, ‹screen: xONIA 4.00 %›. Two collaterals under it: tokenized Tesla, marked by **Pyth**, and ANTHROPIC, a **PreStocks** pre-IPO token at a 200 % haircut." |
| **0:30** | the two verdict badges side by side | "Look at these two badges. One says the chain would accept a loan right now. The other says the quote is stale — so **the chain itself refuses to lend against it**. That rule is in the program, not in my dashboard. No fresh price, no loan." |
| **0:45** | *Try it with a devnet burner* → Desk → pick the accepting listing → **Run it** | "Let me do it. No wallet, no funds — the browser makes a throwaway key." *(press Run it)* "Derive keys, join, set up a confidential account, wrap the collateral, seal a bid." |
| **1:00** | transactions landing in the rail (~37 s — this narration covers it) | "While that lands: my bid's size is encrypted — to my key and the desk's auditor key — before it leaves this tab. On chain goes a ciphertext and a short proof it's well formed. The chain adds everyone's encrypted bids **without opening any of them**: Token-2022 confidential balances, homomorphic addition, Solana's own primitives. No custom circuits, no trusted setup." |
| **1:25** | the confirmed bid | "Sealed bid, ‹screen: three transactions›. Public: that I'm a member, my side, my rate, the timing. Not public: how much." |
| **1:40** | Market → the Pyth mark card | "When my bid matches, I prove the collateral covers the loan. Pyth's price isn't a label beside that number — it's a **coefficient inside the zero-knowledge proof**: collateral times price is at least 150 % of the loan, proven without revealing either. The same price gates every seizure." |
| **2:00** | Market → the PreStocks card | "The pre-IPO side is **PreStocks**: their published mark on chain, what the token trades at beside it, and the gap. And this is the real token on **mainnet**, read in your browser — Token-2022, confidential transfers, a rebasing amount, and a transfer hook, which is why a bonding curve can't quote it." |
| **2:15** | Agent page (key 5): the journey, then the pool card, then the Clawpump card | "The lender is an autonomous agent. Its token launched on a **Meteora** bonding curve **quoted in a tokenized stock**, configured from this desk: the raise target through the same Pyth read, the fee decaying over one loan tenor ‹screen›. We ran the whole lifecycle on devnet first — a pool filled its curve and graduated into DAMM v2, liquidity locked. Its identity and fee wallet is a **Clawpump** agent: running, and the pool's fee claimer." |
| **2:40** | Explorer → **Re-verify in this browser** → the six stages → the green verdict | "And you don't have to trust me about any of it. This re-runs the same verifier the chain ran — in your browser, from raw accounts — and recomputes the rate itself. ‹screen: re-verified in ~2 seconds›." |
| **2:55** | back to Home | "One honest limit: the administrator holds the auditor key and can read individual amounts. What it can't do is lie — every total it publishes carries a proof. The rate is public. The price is public. The position never was." |

---

## If you need to trim

Cut the 1:00 beat to its first two sentences, and the PreStocks beat to one. **Never cut 0:30 or 1:40** — the refusal
badge and the coefficient-inside-the-proof line are the two things judges remember.

## Do not say these wrong

- The re-verify stepper has **six** stages.
- The autopilot bids **four ticks — 100 basis points — past the last print** (or 3.00 % if nothing has printed yet).
- Seven pages, number keys **1–7**: Home · Desk · Positions · Market · Agent · Explorer · Build.
- The Explorer's prev/next buttons promise `[` and `]` shortcuts **that do not exist**. Don't reach for them on camera.
- The lender agent's pool and identity coin are on **mainnet**; the lending desk itself is on devnet.
