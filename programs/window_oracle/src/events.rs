use anchor_lang::prelude::*;

#[event]
pub struct PrintBegun {
    pub epoch: u64,
    pub nonzero_ticks: u8,
}

#[event]
pub struct TicksAttested {
    pub epoch: u64,
    pub attested: u8,
}

/// Aggregates only.
#[event]
pub struct Printed {
    pub epoch: u64,
    pub r_star_tick: u8,
    pub r_star_bps: u32,
    pub matched_volume: u64,
    pub stale: bool,
    pub tau: u16,
}

#[event]
pub struct NoTrade {
    pub epoch: u64,
    pub tau: u16,
}

#[event]
pub struct PrintMissed {
    pub epoch: u64,
    pub tau: u16,
}
