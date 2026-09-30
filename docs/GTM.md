# Go to market, and what would validate it

Written for a judge reading the Colosseum submission. The product write-up is
[`SUBMISSION.md`](SUBMISSION.md); the spoken pitch is [`VIDEO_PITCH.md`](VIDEO_PITCH.md). Every number
below is measured, with the command that produced it at the bottom — including the ones that are
uncomfortable.

## The market, measured

Tokenized equities on Solana are no longer a demo. Measured **2026-09-30** from Jupiter's public
token API, the xStocks family alone:

| | |
|---|---|
| Tokenized float, 20 tickers | **$1,046,880,004** |
| On-chain pool liquidity behind it | **$26,532,135** |
| Holder positions | ~681,000 |
| Largest single ticker (SPCXx) | $83.7 M float |
| TSLAx, the one this desk lists | $80.9 M float · $1.17 M liquidity · 41,880 holders |

A billion dollars of equity exposure sits in wallets, and almost none of it is financeable. There is
no borrow market for it and no reference rate — the two things that make an equity position a
balance-sheet asset rather than a bet. Every one of those holders has the same two choices: sell, or
do nothing.

## Why the borrow market has not appeared

Not for want of demand — securities lending is one of TradFi's largest quiet businesses. The
obstacle is that **on a transparent chain, borrowing against a position publishes the position.**
Size, entry, leverage and liquidation price all become public the moment you post collateral. That
is not a privacy preference; it is an economic one. A visible margin position is a target: it gets
front-run into, and liquidated by spectators who can see the level.

So the order book that would clear this market cannot form. The people with the most to lend against
are precisely the ones who cannot afford to show it.

## The wedge

One product, narrow on purpose: **an overnight borrow market for tokenized stock where sizes are
encrypted and the clearing rate is public.**

- Holders wrap Token-2022 collateral into confidential balances and bid in a sealed-bid,
  uniform-price auction. Side and rate tick are public; size is a ciphertext.
- The program sums ciphertexts homomorphically and the administrator must **prove** every total it
  publishes. The oracle recomputes the clearing rate itself, so a valid proof with a wrong rate is
  rejected.
- That rate is **xONIA** — a printed, re-verifiable overnight rate for tokenized equities. It is the
  part that compounds: a benchmark is infrastructure other products quote against, and nobody has
  one for this asset class.

Solvency is one homomorphic statement — `(price × multiplier) · E_collateral − haircut · E_loan ≥ 0`
— proven against a public mark, with the corporate-action multiplier inside the check. No fresh
price means no lock and no seizure. The desk's answer to a dead oracle is inaction, never a stale
number: today the Pyth-marked TSLAx listing refuses locks on the live site, because Pyth's own
account for that feed has not updated in seven days, and the card says so.

## First users, in order

1. **xStocks holders who want dollars without selling.** The measured population is ~681,000 holder
   positions. The pitch is one sentence — borrow against it, nobody sees your size — and the desk
   already has the wallet-free path: a devnet burner borrows in about twenty seconds with no
   extension installed. The first hundred come from the xStocks and Solana DeFi communities, where
   the complaint ("I can hold it but I can't do anything with it") is already the common one.
2. **Market makers and desks who want the other side.** They are underwriting a rate, not a name:
   sealed size is the reason they can quote without being picked off. The lender agent already
   demonstrates the role end to end and its capital is raised on a public curve.
3. **Protocols that need a rate to quote against.** Once xONIA prints reliably, it is the input for
   fixed-term lending, basis trades and structured products on tokenized equities — the same way an
   overnight benchmark underpins those products off-chain.

The go-to-market order matters: the rate is only credible once real depth clears against it, so
step 1 is a user-acquisition problem and step 3 is the durable position.

## What the desk earns

Today: **nothing.** There is no protocol fee in any of the five programs, and that is a deliberate
omission rather than an oversight — the rate is entirely lender-to-borrower while the mechanism is
being proven.

What is live and earning is the lender agent. Its token launched on a Meteora bonding curve quoted
in real TSLAx; the curve's fee opens at 300 bp and decays to 30 bp over one tenor of the desk, and
every fee claims to the agent's own wallet, `39VKQn…A7sM`, which anyone can watch. Ten per cent of
the raise goes to the agent as lending capital.

The natural protocol revenue is an origination spread on the cleared rate — a tick, taken from the
spread rather than added to the borrower's cost — or a share of the agent's stream. Both are
decisions we have not made, and we would rather say that than quote a fee schedule nobody has
tested.

## What we have not proven

Stated plainly, because a judge will find it anyway:

- **No users.** The auction's depth today comes from six labelled simulated agents. They are
  disclosed on the page, in the docs, and in the code that drives them.
- **No mainnet desk.** The five programs are on devnet; the collateral is devnet twins of real
  mints. The lender agent's pool, its token and its identity coin are the only mainnet pieces.
- **No audit, and one disclosed key** plays administrator, keeper, operator and price poster.
- **Funding and repayment magnitudes are attested, not proven** — the one place the administrator is
  trusted for a number rather than made to prove it.
- **xONIA is a devnet reference rate**, not a regulated benchmark.

What would change our minds fastest, in order: a hundred wallets borrowing without us asking them
to; one market maker quoting the other side unprompted; one protocol quoting xONIA.

## Reproduce every number here

```bash
curl -s "https://lite-api.jup.ag/tokens/v2/search?query=xstock"   # float, liquidity, holders
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule        # what the chain would accept now
./target/release/window-admin --cluster devnet --profile devnet price-check
```

The mainnet pool, token and identity coin are in
[`deployments/launch-mainnet.json`](../deployments/launch-mainnet.json), every address links to an
explorer from the Agent page, and any past print can be re-verified in your own browser from raw
account data on the Explorer page.
