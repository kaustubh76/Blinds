# The 2–3 minute live demo

What to click and what to say, against a clock, with all four integrations named. Operations
(budget, start/stop, failures) are [`RUNBOOK.md`](RUNBOOK.md); addresses and the long walkthrough are
[`DEMO.md`](DEMO.md).

Figures written `‹screen›` change every window — read them off the page, never from here.

---

## Pre-flight — the five minutes before

```bash
./scripts/market.sh start          # faucet line must say (ok); note the ?admin=… link it prints
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule   # today's marks, and which listing is ACCEPTED
grep -aoE "[0-9T:]+Z.*epoch (opened|closed)" /tmp/window-admin-devnet.log | tail -2   # where the window is
```

1. **Wait for a window to open. This is the one thing that can break the demo.** A window is open
   only ~8–9 minutes out of every ~14½, and a bid can only be sealed while it is open. Measured on
   22 Sep: with a window open the autopilot reaches a confirmed bid in **37 seconds**; with the window
   closed it prints *"no window is open — waiting for the keeper to open the next one"* and sits there
   for **up to six minutes**. Start when the header reads `closes in 8:…` — ideally within a minute of
   a window opening, which gives you the whole demo inside one window.
2. **Fresh browser window** (or incognito): no extensions, no saved settings. Zoom 110 %, DevTools closed.
3. Open the site from the `?admin=…` link — that is what makes *Try it with a devnet burner* work.
4. Know which listing is accepting today (`pnpm schedule`). On 22 Sep it was **ANTHROPIC** —
   pick that one on the Desk.
5. Second tab on `#/explorer`, in case you are asked to prove a print.

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
| **2:05** | **Agent** (key 5) | "One more thing — the lender on the other side is an autonomous agent. Its capital token, WLEND, launched on a **Meteora** Dynamic Bonding Curve quoted in a tokenized stock, and every parameter came from the desk's own numbers: the raise target converted through Pyth's read of TSLAx, the fee decaying 300 to 30 basis points over exactly one loan tenor. ‹screen: 2.9 % to graduation, fee 30.1 bp›. Its identity and fee wallet are a **Clawpump** coin." |
| **2:30** | back to **Home** (or Explorer) | "All of it is live on devnet — five programs, ‹screen: 206› prints. And you don't have to trust me about any print: the Explorer re-derives it from the raw accounts in *your* browser. One honest limit: the administrator holds the auditor key and can read individual amounts to run the market — it proves every aggregate it publishes. That's accountable privacy, and we say so on every page." |

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
