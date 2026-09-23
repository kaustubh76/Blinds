# The 2–3 minute live demo

What to click and what to say, against a clock, with all four integrations named. Operations
(budget, start/stop, failures) are [`RUNBOOK.md`](RUNBOOK.md); addresses and the long walkthrough are
[`DEMO.md`](DEMO.md).

Figures written `‹screen›` change every window — read them off the page, never from here.

---

## Pre-flight — the five minutes before

```bash
./scripts/judging_day.sh up        # market + tunnel watchdog + published faucet URL, then it waits for a
                                   # window to open and checks every route and recipe on the hosted site
./scripts/judging_day.sh status    # where the window is, what it is costing, the share link
```

It prints the `?admin=…` share link, which listing the chain would accept right now, and the window's phase.
(`market.sh start` alone still works; it refuses to run a `target/release/window-admin` older than the source.)

1. **Wait for a window to open. This is the one thing that can break the demo.** A bid can only be
   sealed while a window is open. Measured again on 23 Sep (epochs 565–570): a window is open
   **~8½ minutes** of a **~15 minute** cycle, the print lands ~20 s after it closes, and the next window
   opens ~6 minutes later. `epoch_slots` is a slot count and devnet now runs ~0.17 s/slot, so what paces
   a window in wall-clock terms is how long a keeper tick takes — measure it, never assume it. With a
   window open the autopilot reaches a confirmed bid in **~37 seconds**; with it closed the Desk says
   *"no window is open"* and waits. Start within a minute of a window opening.
2. **Fresh browser window** (or incognito): no extensions, no saved settings. Zoom 110 %, DevTools closed.
3. Open the site from the `?admin=…` link — that is what makes *Try it with a devnet burner* work.
4. Know which listing is accepting today (`judging_day.sh up` prints it, or `pnpm schedule`). On
   23 Sep it was **ANTHROPIC** (TSLAx is refused while Pyth's wrapper account is stale — that refusal
   is part of the story, see 0:35). Pick the accepting one on the Desk.
5. A funded loan now runs its whole life inside the demo: the tenor starts when the operator funds it
   and is ~8 minutes at today's slot pace, with repayment attested about half way. Do not be surprised
   when a loan you just funded is already repaid.
6. Second tab on `#/explorer`, in case you are asked to prove a print.

---

## The script

| time | on screen | say this |
|---|---|---|
| **0:00** | **Home**, hero | "This is a private margin desk for tokenized stocks, live on Solana devnet. People borrow dollars overnight against tokenized shares. Every few minutes the whole market clears at one rate — that's this number, ‹screen: xONIA 4.00 %›. The rate is public. The price is public. The position never is." |
| **0:20** | scroll to the two collateral cards | "Two collaterals, one rate. TSLAx — tokenized Tesla — marked by **Pyth**. And ANTHROPIC, a **PreStocks** pre-IPO token, at a 200 % haircut because it's pre-IPO. ‹screen: $1,050›, fetched ‹screen: 36 seconds› ago." |
| **0:35** | point at the two badges: *accepting* vs *quote stale* | "Look at these two badges. One says accepting. The other says the quote is stale — three hours old against a sixty-minute limit — so **the chain itself refuses to lend against it**. That rule is in the program, not in my dashboard. No fresh price, no loan." |
| **0:50** | **Desk** → *Try it with a devnet burner* → pick **ANTHROPIC** → *Autopilot* | "Let me do it live. No wallet, no funds — the browser makes a throwaway key." *(click Autopilot)* "That's derive keys, join, set up a confidential account, wrap the collateral, and seal a bid." |
| **1:05** | transactions landing in the rail (~37 s of work; this narration covers it) | "While that lands: the size of my bid is encrypted to my key and the desk's auditor key before it leaves the tab. What goes on chain is a ciphertext and a 320-byte proof that it's well formed. The chain adds up everyone's encrypted bids **without opening them** — that's Token-2022 confidential balances plus homomorphic addition." |
| **1:25** | the confirmed bid | "Sealed bid, on devnet, ‹screen: three transactions›. What's public: that I'm a member, which side I took, the rate tick, the timing. What isn't: how much." |
| **1:35** | **Market** → the Pyth mark card | "When my bid matches, I have to prove my collateral covers the loan. Pyth's price isn't a label next to the number — it's a **coefficient inside the zero-knowledge proof**: collateral × price ≥ 150 % × loan, proven without revealing either amount. The same price gates every seizure. That's what makes this a margin desk and not a spreadsheet." |
| **1:55** | **Market**, scroll to the PreStocks card | "The pre-IPO side is **PreStocks**. The mark on chain is their published price, copied by our keeper and stamped with the fetch time — we say that, we don't dress it up as a signed feed. Beside it, what the token actually trades at and the gap in basis points ‹screen: −117 bp›, and the same gap at company scale. This line is the real token on **mainnet**, read in your browser: Token-2022, confidential transfers, a rebasing amount — the machinery this desk wraps — and a transfer hook, which is exactly why a bonding curve cannot quote it." |
| **2:10** | **Agent** (key 5) | "The lender on the other side is an autonomous agent. Its capital token launched on a **Meteora** Dynamic Bonding Curve quoted in a tokenized stock, and every parameter came from the desk's own numbers: the raise target converted through Pyth's read of TSLAx, the fee decaying 300 to 30 basis points over exactly one loan tenor ‹screen: the fee curve and where it is now›. And we ran the whole lifecycle, not a slide — one pool filled its curve and **migrated into a DAMM v2 pool with its liquidity locked for good** ‹screen: the journey, step 5 done›. Its identity and fee wallet are a **Clawpump** agent: running, and the pool's creator." |
| **2:35** | back to **Home** (or Explorer) | "All of it is live on devnet — five programs, ‹screen: the print count› prints. And you don't have to trust me about any print: the Explorer re-derives it from the raw accounts in *your* browser. One honest limit: the administrator holds the auditor key and can read individual amounts to run the market — it proves every aggregate it publishes. That's accountable privacy, and we say so on every page." |

Roughly 400 words. If you are running long, cut the 1:05 beat to its first sentence — never the
0:35 badges or the 1:35 proof, which are the two beats judges remember.

---

## When something goes wrong

| | |
|---|---|
| **Window closed** (`no trade`, grey ring) | Don't wait on camera. "The window's between rounds — it opens every few minutes." Show the xONIA series instead: "here are the last ‹screen› prints", then jump to 1:35. |
| **Autopilot says "no window is open"** | You started between windows and it will sit there for minutes. Don't wait: "it's between rounds — the bid seals when the next one opens." Go to 1:35 and come back to the Desk at the end if there's time. |
| **Autopilot just slow** | Normal is ~37 s and the 1:05 narration covers it. If it runs long, open the console (`` ` ``): "every transaction here is the SDK code that produced it." |
| **Faucet unreachable** | "The faucet is the one piece that runs on my machine." Every read-only page still works — go to Market and Explorer, which need nothing of ours. |
| **A number looks wrong or stale** | Say what it means. A stale quote is the freshness rule working; that *is* the Pyth story. |
| **Blank page** | Reopen in a new incognito window. The page now shows a reload panel instead of nothing if its code fails to load. |
| **RPC sluggish** | The hosted mirror proxies its reads; refresh once. Don't apologise for devnet — move on. |

---

## Drop-ins, when a particular judge is listening

- **Pyth** — "Pyth is the coefficient `k_c` inside the solvency proof and the gate on `seize`. Two limits are enforced on chain per listing: how long ago the keeper posted, and how old the publisher's own timestamp is. That's why one of my listings is refusing loans right now."
- **PreStocks** — "ANTHROPIC is listed beside a listed stock under one rate, at a 200 % haircut, marked by the published price. We also show the basis between the mark and the implied token price — and we label it an attested mark, not a signed feed, because the keeper copies it."
- **Meteora** — "The curve isn't a token launch bolted on. It's quoted in a tokenized stock, the raise target is the desk's own $250k fully-diluted figure converted through Pyth, and the fee decays over exactly one loan tenor. Devnet rehearsal today, same program and configuration as the mainnet launch."
- **Clawpump** — "The agent needed an identity that isn't me: a coin and a wallet, which is the pool's creator and fee claimer. The Agent page computes each step from the launch record or the chain — nothing is a claim."

---

## Questions you will get

| | |
|---|---|
| *Can the administrator see my position?* | "Yes — it holds the auditor key and reads amounts to run the market. It proves every per-tick sum it publishes, and anyone can re-verify that in their browser. We call it accountable privacy, never anonymity." |
| *Is that real trading volume?* | "No. Six simulated members provide the depth, and they're labelled `simulated` in the deployment file. The mechanism is real; the demand is ours." |
| *Why devnet?* | "The programs are deployed and the upgrade authority is still ours. The mints are devnet twins — no mainnet token is touched. The mainnet piece is the agent's token launch, which is one command." |
| *What if the price feed dies?* | "It did — the Pyth push account we read stopped on 12 September. The chain refuses to lend on a stale quote, which is exactly what you can see on screen. Inaction, never a wrong action." |
| *What's actually on chain vs in your app?* | "The proofs, the sums, the rate, the loans, the freshness rules. The dashboard only reads — Market, Explorer and Positions work with none of my services running." |
| *Why one uniform rate?* | "It's a benchmark — xONIA, an overnight index average. Everyone who clears, clears at the same rate, which is what makes it quotable." |
| *How big is the trusted piece?* | "One administrator, disclosed, whose every decryption is proven on chain at each print. That's the whole trust surface, and the threat model is written down." |
| *Could I integrate this?* | "The Build page has runnable recipes, the IDLs and the SDK — `#/build`." |

---

## Read these before you present

```bash
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule   # marks, ages, which listing is ACCEPTED
./scripts/market.sh status                                    # faucet health, hours of runway left
```

Then open the Agent page and read the curve figures off it. Every `‹screen›` in this script is a
number you say from the page in front of you.
