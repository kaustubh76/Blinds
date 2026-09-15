//! Uniform-price clearing for THE WINDOW for Stocks, exactly as specified in §7.3:
//!
//! ```text
//!   S(r) = Σ_{t ≤ r} v^ASK_t        cumulative supply willing to lend at rate r or below
//!   D(r) = Σ_{t ≥ r} v^BID_t        cumulative demand willing to borrow at rate r or above
//!   r*   = min { r : S(r) ≥ D(r) > 0 }
//!   matched = min(S(r*), D(r*)) = D(r*)
//! ```
//!
//! Bids are always fully filled at r* (every bid at tick ≥ r* accepts r*, and S(r*) ≥ D(r*)).
//! Supply is filled by price priority: asks at lower ticks first, and the *marginal* tick — the
//! highest ask tick actually needed — is filled pro-rata. That ratio is public (spec §7.3
//! "computed by the administrator and disclosed"); it is the same for every ask at the marginal
//! tick and therefore reveals no individual size.
//!
//! This crate is `#![no_std]` and allocation-free: `window_oracle` calls [`clear`] on-chain to
//! recompute r* from the proven aggregates, and the administrator, indexer and tests call the same
//! function off-chain. There is exactly one implementation of the rule.

#![no_std]
#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod regime;

/// Number of rate ticks on the grid (1.00% … 10.00% at 25 bp).
pub const TICKS: usize = 37;
/// Rate at tick 0, in basis points.
pub const MIN_BPS: u32 = 100;
/// Tick spacing in basis points.
pub const TICK_BPS: u32 = 25;
/// Every bid size is range-proven below `2^BID_BITS` micro-USDC at submission.
pub const BID_BITS: u32 = 40;

/// Order side. The discriminants are the on-chain encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "std", derive(serde::Serialize, serde::Deserialize))]
#[repr(u8)]
pub enum Side {
    /// Lend USDC (supply).
    Ask = 0,
    /// Borrow USDC against stock collateral (demand).
    Bid = 1,
}

impl Side {
    /// Decodes the on-chain byte.
    pub const fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Ask),
            1 => Some(Self::Bid),
            _ => None,
        }
    }
    /// Index into `[.; 2]` arrays.
    pub const fn index(self) -> usize {
        self as usize
    }
}

/// A rate tick in `0..TICKS`. Construction is checked so an out-of-band tick cannot exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "std", derive(serde::Serialize, serde::Deserialize))]
#[repr(transparent)]
pub struct Tick(u8);

impl Tick {
    /// Lowest tick (1.00%).
    pub const MIN: Tick = Tick(0);
    /// Highest tick (10.00%).
    pub const MAX: Tick = Tick(TICKS as u8 - 1);

    /// `None` if `t >= TICKS`.
    pub const fn new(t: u8) -> Option<Self> {
        if (t as usize) < TICKS {
            Some(Self(t))
        } else {
            None
        }
    }
    /// Raw tick number.
    pub const fn get(self) -> u8 {
        self.0
    }
    /// Index into `[.; TICKS]` arrays.
    pub const fn index(self) -> usize {
        self.0 as usize
    }
    /// Rate in basis points: `100 + 25·t`.
    pub const fn bps(self) -> u32 {
        MIN_BPS + TICK_BPS * self.0 as u32
    }
    /// Whether this tick is at either end of the band (regime flag input, §7.5).
    pub const fn is_band_edge(self) -> bool {
        self.0 == 0 || self.0 as usize == TICKS - 1
    }
}

/// Per-tick aggregate sizes in micro-USDC, as proven by the print.
///
/// (No serde derive: serde has no impls for `[u64; 37]`; the indexer serialises curves as
/// explicit `{tick, ask, bid}` rows instead.)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DepthCurve {
    /// `ask[t]` = Σ lend offers at tick t.
    pub ask: [u64; TICKS],
    /// `bid[t]` = Σ borrow bids at tick t.
    pub bid: [u64; TICKS],
}

impl Default for DepthCurve {
    fn default() -> Self {
        Self { ask: [0; TICKS], bid: [0; TICKS] }
    }
}

impl DepthCurve {
    /// Empty curve.
    pub const EMPTY: DepthCurve = DepthCurve { ask: [0; TICKS], bid: [0; TICKS] };
}

/// Result of a successful cross.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "std", derive(serde::Serialize, serde::Deserialize))]
pub struct Clearing {
    /// The uniform clearing rate.
    pub r_star: Tick,
    /// Volume that changes hands: `min(S(r*), D(r*))`, which equals `D(r*)`.
    pub matched: u64,
    /// `S(r*)`.
    pub supply_at: u64,
    /// `D(r*)`.
    pub demand_at: u64,
}

/// Exact rational in `[0, 1]` (`den > 0`, `num ≤ den`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "std", derive(serde::Serialize, serde::Deserialize))]
pub struct Ratio {
    /// Numerator.
    pub num: u64,
    /// Denominator, never zero.
    pub den: u64,
}

impl Ratio {
    /// `1/1`.
    pub const ONE: Ratio = Ratio { num: 1, den: 1 };
    /// `floor(amount · num / den)`, overflow-safe through u128.
    pub const fn apply(self, amount: u64) -> u64 {
        ((amount as u128 * self.num as u128) / self.den as u128) as u64
    }
}

/// How supply is allocated at the clearing rate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "std", derive(serde::Serialize, serde::Deserialize))]
pub struct AskAllocation {
    /// Highest ask tick that receives any fill. Asks below it fill fully; asks above it get nothing.
    pub marginal_tick: Tick,
    /// Fraction of each ask *at* the marginal tick that is filled.
    pub marginal_ratio: Ratio,
}

/// Arithmetic failure. Aggregates are bounded by `n_t · 2^40` per tick on-chain, so this can only
/// fire on malformed input, but the on-chain path must still never panic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClearError {
    /// A cumulative sum exceeded `u64::MAX`.
    Overflow,
}

/// Cumulative curves `(S, D)` with `S[r] = Σ_{t≤r} ask[t]` and `D[r] = Σ_{t≥r} bid[t]`.
pub fn cumulative(curve: &DepthCurve) -> Result<([u64; TICKS], [u64; TICKS]), ClearError> {
    let mut supply = [0u64; TICKS];
    let mut demand = [0u64; TICKS];
    let mut acc = 0u64;
    for (s, ask) in supply.iter_mut().zip(curve.ask.iter()) {
        acc = acc.checked_add(*ask).ok_or(ClearError::Overflow)?;
        *s = acc;
    }
    acc = 0;
    for (d, bid) in demand.iter_mut().zip(curve.bid.iter()).rev() {
        acc = acc.checked_add(*bid).ok_or(ClearError::Overflow)?;
        *d = acc;
    }
    Ok((supply, demand))
}

/// The §7.3 clearing rule. `Ok(None)` means no trade (no rate at which supply covers demand).
pub fn clear(curve: &DepthCurve) -> Result<Option<Clearing>, ClearError> {
    let (supply, demand) = cumulative(curve)?;
    for t in 0..TICKS {
        let (s, d) = (supply[t], demand[t]);
        if d > 0 && s >= d {
            // `Tick::new` cannot fail for t < TICKS; unwrap_or keeps the on-chain path panic-free.
            let r_star = Tick::new(t as u8).unwrap_or(Tick::MAX);
            return Ok(Some(Clearing { r_star, matched: d, supply_at: s, demand_at: d }));
        }
    }
    Ok(None)
}

/// Price-priority allocation of supply for a given clearing (see module docs).
///
/// The marginal tick is `min { m ≤ r* : S(m) ≥ D(r*) }`; it exists because `S(r*) ≥ D(r*)`.
pub fn ask_allocation(curve: &DepthCurve, cl: &Clearing) -> Result<AskAllocation, ClearError> {
    let (supply, _) = cumulative(curve)?;
    let needed = cl.demand_at;
    for m in 0..=cl.r_star.index() {
        if supply[m] >= needed {
            let below = if m == 0 { 0 } else { supply[m - 1] };
            let at_tick = curve.ask[m];
            // `needed - below` ≤ at_tick because supply[m] = below + at_tick ≥ needed > below.
            let take = needed.saturating_sub(below);
            let marginal_ratio = if at_tick == 0 || take >= at_tick {
                Ratio::ONE
            } else {
                Ratio { num: take, den: at_tick }
            };
            let marginal_tick = Tick::new(m as u8).unwrap_or(Tick::MAX);
            return Ok(AskAllocation { marginal_tick, marginal_ratio });
        }
    }
    // Unreachable for a Clearing produced by `clear`; treated as "everything up to r* fills".
    Ok(AskAllocation { marginal_tick: cl.r_star, marginal_ratio: Ratio::ONE })
}

/// The §7.2 bound check: a claimed per-tick sum can be at most `n_t · 2^BID_BITS` because every
/// contributing bid was range-proven below `2^BID_BITS`.
pub const fn bound_ok(sum: u64, bid_count: u32) -> bool {
    (sum as u128) <= (bid_count as u128) << BID_BITS
}
