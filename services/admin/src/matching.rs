//! From decrypted bids to matches (spec v2 §7.3): every bid at tick ≥ r* is filled in full;
//! supply is taken by price priority, asks at the marginal tick pro-rata. Lenders are assigned to
//! borrowers greedily; a bid that spans lenders becomes several loans (`Partial`).

use solana_pubkey::Pubkey;
use window_clearing::{AskAllocation, Clearing, Side, Tick};

use crate::Secret;

#[derive(Debug, Clone)]
pub struct DecryptedBid {
    pub member: Pubkey,
    pub side: Side,
    pub tick: u8,
    pub size: Secret<u64>,
}

#[derive(Debug, Clone)]
pub struct Match {
    pub borrower: Pubkey,
    pub bid_tick: u8,
    pub lender: Pubkey,
    pub ask_tick: u8,
    /// k-th loan of this borrower's bid.
    pub k: u8,
    /// Loan size; equals the bid size iff `full`.
    pub size: Secret<u64>,
    pub full: bool,
}

pub fn compute(bids: &[DecryptedBid], cl: &Clearing, alloc: &AskAllocation) -> Vec<Match> {
    let r = cl.r_star.get();
    // Lender volumes by price priority (lower tick first; marginal tick pro-rata).
    let mut lenders: Vec<(Pubkey, u8, u64)> = bids
        .iter()
        .filter(|b| b.side == Side::Ask && b.tick <= alloc.marginal_tick.get())
        .map(|b| {
            let v = if Tick::new(b.tick) == Some(alloc.marginal_tick) {
                alloc.marginal_ratio.apply(*b.size.expose())
            } else {
                *b.size.expose()
            };
            (b.member, b.tick, v)
        })
        .filter(|(_, _, v)| *v > 0)
        .collect();
    lenders.sort_by_key(|(_, t, _)| *t);
    let mut borrowers: Vec<(Pubkey, u8, u64)> = bids
        .iter()
        .filter(|b| b.side == Side::Bid && b.tick >= r)
        .map(|b| (b.member, b.tick, *b.size.expose()))
        .collect();
    borrowers.sort_by_key(|b| std::cmp::Reverse(b.1)); // most eager first

    let mut out = Vec::new();
    let mut left: Vec<u64> = lenders.iter().map(|l| l.2).collect();
    for (borrower, bid_tick, size) in borrowers {
        // Prefer one lender that covers the whole bid (a full fill needs no sealed opening);
        // otherwise split in price priority.
        if let Some(i) =
            (0..lenders.len()).filter(|&i| left[i] >= size).min_by_key(|&i| lenders[i].1)
        {
            left[i] -= size;
            out.push(Match {
                borrower,
                bid_tick,
                lender: lenders[i].0,
                ask_tick: lenders[i].1,
                k: 0,
                size: Secret::new(size),
                full: true,
            });
            continue;
        }
        let mut need = size;
        let mut k = 0u8;
        for i in 0..lenders.len() {
            if need == 0 {
                break;
            }
            if left[i] == 0 {
                continue;
            }
            let take = need.min(left[i]);
            out.push(Match {
                borrower,
                bid_tick,
                lender: lenders[i].0,
                ask_tick: lenders[i].1,
                k,
                size: Secret::new(take),
                full: false,
            });
            need -= take;
            left[i] -= take;
            k = k.saturating_add(1);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use window_clearing::{ask_allocation, clear, DepthCurve};

    #[test]
    fn splits_a_bid_across_lenders_and_marks_full_fills() {
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        let x = Pubkey::new_unique();
        let bids = vec![
            DecryptedBid { member: a, side: Side::Ask, tick: 4, size: Secret::new(100) },
            DecryptedBid { member: b, side: Side::Ask, tick: 6, size: Secret::new(200) },
            DecryptedBid { member: x, side: Side::Bid, tick: 10, size: Secret::new(250) },
        ];
        let mut c = DepthCurve::default();
        c.ask[4] = 100;
        c.ask[6] = 200;
        c.bid[10] = 250;
        let cl = clear(&c).unwrap().unwrap();
        let alloc = ask_allocation(&c, &cl).unwrap();
        let m = compute(&bids, &cl, &alloc);
        assert_eq!(m.len(), 2, "no single lender covers 250: split");
        assert_eq!((m[0].lender, *m[0].size.expose(), m[0].k, m[0].full), (a, 100, 0, false));
        assert_eq!((m[1].lender, *m[1].size.expose(), m[1].k, m[1].full), (b, 150, 1, false));
        // a bid one lender can cover is a full fill with that lender
        let bids2 = vec![
            DecryptedBid { member: a, side: Side::Ask, tick: 4, size: Secret::new(100) },
            DecryptedBid { member: b, side: Side::Ask, tick: 6, size: Secret::new(200) },
            DecryptedBid { member: x, side: Side::Bid, tick: 10, size: Secret::new(150) },
        ];
        let mut c2 = DepthCurve::default();
        c2.ask[4] = 100;
        c2.ask[6] = 200;
        c2.bid[10] = 150;
        let cl2 = clear(&c2).unwrap().unwrap();
        let alloc2 = ask_allocation(&c2, &cl2).unwrap();
        let m2 = compute(&bids2, &cl2, &alloc2);
        // r* = 6, marginal tick 6 with ratio 50/200: b owes only 50, so 150 must split 100 + 50.
        assert_eq!(m2.len(), 2);
        assert_eq!((m2[0].lender, *m2[0].size.expose()), (a, 100));
        assert_eq!((m2[1].lender, *m2[1].size.expose()), (b, 50));
        // one lender that covers the bid → a full fill (no sealed opening needed)
        let bids3 = vec![
            DecryptedBid { member: a, side: Side::Ask, tick: 4, size: Secret::new(300) },
            DecryptedBid { member: x, side: Side::Bid, tick: 10, size: Secret::new(150) },
        ];
        let mut c3 = DepthCurve::default();
        c3.ask[4] = 300;
        c3.bid[10] = 150;
        let cl3 = clear(&c3).unwrap().unwrap();
        let alloc3 = ask_allocation(&c3, &cl3).unwrap();
        let m3 = compute(&bids3, &cl3, &alloc3);
        assert_eq!(m3.len(), 1);
        assert!(m3[0].full && m3[0].lender == a && *m3[0].size.expose() == 150);
        assert_eq!(format!("{:?}", m[0].size), "[redacted]");
    }
}
