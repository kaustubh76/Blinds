use anchor_lang::prelude::*;
use window_clearing::TICKS;

#[derive(Clone, Copy, PartialEq, Eq, Debug, AnchorSerialize, AnchorDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum PrintStatus {
    Attesting = 1,
    Missed = 2,
    Printed = 3,
    NoTrade = 4,
}

impl PrintStatus {
    pub const fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Attesting),
            2 => Some(Self::Missed),
            3 => Some(Self::Printed),
            4 => Some(Self::NoTrade),
            _ => None,
        }
    }
    pub const fn is_final(self) -> bool {
        matches!(self, Self::Printed | Self::NoTrade)
    }
}

/// The benchmark's rolling state and latest-rate view.
#[account]
#[derive(InitSpace)]
pub struct OracleState {
    pub admin: Pubkey,
    pub auction_program: Pubkey,
    pub band_edge_epochs: u8,
    pub stale_after_slots: u64,
    pub has_printed: bool,
    pub last_print_epoch: u64,
    pub last_r_star_tick: u8,
    pub last_matched: u64,
    /// `window_clearing::regime::State`, field by field.
    pub stale: u8,
    pub consecutive_trades: u8,
    pub edge_streak: u8,
    pub interior_streak: u8,
    pub band_edge: u8,
    pub tau: u16,
    pub prints: u64,
    pub bump: u8,
}

impl OracleState {
    pub fn regime(&self) -> window_clearing::regime::State {
        window_clearing::regime::State {
            stale: self.stale,
            consecutive_trades: self.consecutive_trades,
            edge_streak: self.edge_streak,
            interior_streak: self.interior_streak,
            band_edge: self.band_edge,
            _pad: 0,
            tau: self.tau,
        }
    }
    pub fn set_regime(&mut self, r: window_clearing::regime::State) {
        self.stale = r.stale;
        self.consecutive_trades = r.consecutive_trades;
        self.edge_streak = r.edge_streak;
        self.interior_streak = r.interior_streak;
        self.band_edge = r.band_edge;
        self.tau = r.tau;
    }
}

/// One print per epoch. Zero-copy, padding-free layout (672 bytes).
#[account(zero_copy)]
#[repr(C)]
pub struct Print {
    pub epoch: u64,
    /// Attested per-tick sums in micro-USDC, `[side][tick]`.
    pub claimed_sum: [[u64; TICKS]; 2],
    pub matched_volume: u64,
    pub marginal_ratio_num: u64,
    pub marginal_ratio_den: u64,
    pub finalized_slot: u64,
    pub matches_posted: u32,
    pub tau: u16,
    /// Number of ticks attested so far.
    pub attested: u8,
    /// `PrintStatus` discriminant.
    pub status: u8,
    pub missed: u8,
    pub r_star_tick: u8,
    pub marginal_tick: u8,
    pub stale: u8,
    pub regime_flags: u8,
    pub bump: u8,
    /// Ticks with `bid_count > 0` at `begin_print` (bit `side*37 + tick`).
    pub nonzero_bitmap: [u8; 10],
    /// Ticks whose sum has been proven.
    pub proven_bitmap: [u8; 10],
    pub _pad: [u8; 6],
}

impl Print {
    pub const SPACE: usize = 8 + core::mem::size_of::<Print>();
    pub const REGIME_BAND_EDGE: u8 = 1;

    pub fn status(&self) -> Option<PrintStatus> {
        PrintStatus::from_u8(self.status)
    }
}

/// Bit index helpers over the 74-bit maps.
pub fn bit_index(side: usize, tick: usize) -> usize {
    side * TICKS + tick
}
pub fn get_bit(map: &[u8; 10], i: usize) -> bool {
    map[i / 8] & (1 << (i % 8)) != 0
}
pub fn set_bit(map: &mut [u8; 10], i: usize) {
    map[i / 8] |= 1 << (i % 8);
}

/// One attested tick.
#[derive(Clone, Copy, AnchorSerialize, AnchorDeserialize)]
pub struct TickClaim {
    pub side: u8,
    pub tick: u8,
    pub sum: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn print_layout() {
        assert_eq!(core::mem::size_of::<Print>(), 8 + 592 + 8 * 4 + 4 + 2 + 8 + 20 + 6);
    }
}
