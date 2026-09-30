# The 2–3 minute presentation video

Word-for-word narration for the **presentation** video Colosseum asks for — the case for the
company, not the click-through. The product demo is a separate recording:
[`VIDEO_DEMO.md`](VIDEO_DEMO.md). The written case behind every number here is
[`GTM.md`](GTM.md), and the technical explainer is [`VIDEO_TECHNICAL.md`](VIDEO_TECHNICAL.md).

Total: **≈ 430 spoken words** — about 2:35 at 165 words per minute. Colosseum's limit is three
minutes; do not fill it.

Figures written `‹measure›` move. Re-run the command in "Before you record" the morning you record
and read your own numbers, the same rule the demo script uses for on-screen figures.

---

## Before you record

```bash
curl -s "https://lite-api.jup.ag/tokens/v2/search?query=xstock"   # float, liquidity, holders
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule        # which listings the chain accepts
```

1. **Say the market numbers as of the day you record.** On 2026-09-30 they were $1.05 B of float,
   $26.5 M of pool liquidity and ~681,000 holder positions across twenty tickers. If they have
   moved, say the new ones — the whole point of the opening is that it is a measurement.
2. **This is a talking-head or slides video, not a screen recording.** The one place to cut to the
   product is 1:30; a still of the home page or the Agent page is enough.
3. **Do not re-narrate the demo.** A judge watches both. Mechanism detail belongs in the other
   recording; this one has to earn the watch of someone deciding whether the market is real.
4. If you record only one take, record this one after the demo — the honest-limits beat at 2:00 lands
   better once you have just shown the thing working.

---

## The script

| time | on screen | say this |
|---|---|---|
| 0:00 | you, or a title card | There is about a **billion dollars** of tokenized stock sitting in Solana wallets right now. I measured it this morning: twenty tickers, `‹measure›` **$1.05 billion** of float, `‹measure›` **$26 million** of pool liquidity behind it, `‹measure›` around **six hundred thousand** holder positions. Almost none of it is financeable. There is no borrow market for it, and no interest rate. |
| 0:22 | — | That is not because nobody wants one. Securities lending is one of the largest quiet businesses in traditional finance. It is because on a transparent chain, **borrowing against a position publishes the position** — your size, your leverage, the price you get liquidated at. A visible margin position is a target. So the people with the most to lend against are exactly the ones who cannot afford to show it. |
| 0:48 | — | THE WINDOW is an overnight borrow market for tokenized stock where **the sizes are encrypted and the rate is public**. You wrap your collateral into a confidential balance and bid in a sealed auction. Side and rate tick are public; the size is a ciphertext. The program adds those ciphertexts up without ever decrypting a bid — and then it makes us **prove** every total we publish, and recomputes the clearing rate itself, so a valid proof with the wrong rate is rejected. |
| 1:18 | the rate, on the home page | That rate is **xONIA**. It is the part that matters beyond us: a printed, re-verifiable overnight rate for tokenized equities. Nobody has one. A benchmark is infrastructure — other products quote against it. |
| 1:33 | home page, then the Agent page | This runs. Five programs on devnet printing a rate every window. A dashboard where you can borrow in about twenty seconds with no wallet extension installed. An explorer that re-proves any past print **in your own browser**, from raw account data. And the lender agent is on **mainnet** — its token launched on a Meteora bonding curve quoted in real TSLAx, and every fee claims to its own wallet, which you can watch. |
| 2:02 | you | What I will not claim: **there are no users yet.** The depth in that auction is six simulated agents, and they are labelled as such on the page itself. The desk is on devnet. We take no fee. I would rather show you something that works and tell you what it has not proven — which is the same reason the TSLAx card on the live site says **refused** today: Pyth stopped updating that feed seven days ago, and a stale price should not pass as a fresh one. |
| 2:28 | title card, repo + live URL | A billion dollars of collateral, no rate to borrow it at, and a privacy problem that is the reason why. That is the market. This is the mechanism. Everything I have said is checkable from the repo. |

---

## If you need to trim

Cut in this order — each is self-contained, and the beats around it still join up:

1. The explorer clause at 1:33 ("An explorer that re-proves … from raw account data") — the demo
   video shows it. Saves ~12 s.
2. The parenthetical mechanism at 0:48 ("and recomputes the clearing rate itself … is rejected").
   Saves ~10 s. Keep "makes us prove every total": that is the sentence the claim rests on.
3. The Meteora clause at 1:33 down to "the lender agent is on mainnet, earning its own fees."

Never cut 2:02. A submission that states its limits before a judge finds them is the one that gets
believed about everything else.

## Do not say these wrong

- The desk is on **devnet**. The lender agent's **pool, token and identity coin** are on mainnet.
  Never "we are live on mainnet" unqualified.
- **No users, no fee, no audit.** All three are in the 2:02 beat; do not soften any of them.
- The simulated agents are **six**, and they are labelled on the page — not "some liquidity".
- xONIA is a **devnet reference rate**, not a regulated benchmark.
- The market figures are **measured, not projected**. If you have not re-run the command, say the
  date you measured them.
- The Pyth listing is refused because **Pyth's own account for that feed is stale**, not because
  anything here is broken — and the desk lists a second TSLAx mark, priced from the token's own
  market, which the chain does accept.
