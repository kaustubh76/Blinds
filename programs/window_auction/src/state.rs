use anchor_lang::prelude::*;
use window_clearing::TICKS;

/// Epoch lifecycle (`Epoch.status`).
#[derive(Clone, Copy, PartialEq, Eq, Debug, AnchorSerialize, AnchorDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum EpochStatus {
    Open = 1,
    Closed = 2,
    Printed = 3,
    NoTrade = 4,
}

impl EpochStatus {
    pub const fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Open),
            2 => Some(Self::Closed),
            3 => Some(Self::Printed),
            4 => Some(Self::NoTrade),
            _ => None,
        }
    }
    pub const fn is_settled(self) -> bool {
        matches!(self, Self::Printed | Self::NoTrade)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub keeper: Pubkey,
    pub oracle_program: Pubkey,
    pub registry_program: Pubkey,
    pub auditor_elgamal_pubkey: [u8; 32],
    pub cusdc_mint: Pubkey,
    pub cstock_mint: Pubkey,
    pub epoch_slots: u64,
    pub keeper_grace_slots: u64,
    pub stale_after_slots: u64,
    /// Minimum bid size in micro-USDC; range proofs are on `(size − s_min)`.
    pub s_min: u64,
    pub max_bids_per_epoch: u32,
    /// Number of epochs ever opened; the next epoch's index.
    pub epochs_opened: u64,
    /// Index of the most recently opened epoch.
    pub current_epoch: u64,
    pub has_open_epoch: bool,
    pub bump: u8,
}

/// Per-epoch accumulators. Zero-copy: 5,096 bytes of fixed layout, no borsh round-trip per bid.
/// Field order avoids implicit padding (bytemuck `Pod` refuses padding).
#[account(zero_copy)]
#[repr(C)]
pub struct Epoch {
    pub index: u64,
    pub start_slot: u64,
    /// 0 until closed.
    pub close_slot: u64,
    /// Auditor ElGamal key in force for this epoch's bids.
    pub auditor_pubkey: [u8; 32],
    /// Σ commitments, `[side][tick]`; identity when never accumulated.
    pub acc_commitment: [[[u8; 32]; TICKS]; 2],
    /// Σ auditor decrypt handles, `[side][tick]`.
    pub acc_handle: [[[u8; 32]; TICKS]; 2],
    pub bid_count: [[u32; TICKS]; 2],
    pub total_bids: u32,
    /// `EpochStatus` discriminant.
    pub status: u8,
    pub bump: u8,
    pub _pad: [u8; 2],
}

impl Epoch {
    pub const SPACE: usize = 8 + core::mem::size_of::<Epoch>();

    pub fn status(&self) -> Option<EpochStatus> {
        EpochStatus::from_u8(self.status)
    }
}

/// One encrypted bid. Its `init` is the one-bid-per-(epoch, member, side, tick) guard.
#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub epoch: u64,
    pub member: Pubkey,
    pub side: u8,
    pub tick: u8,
    /// Grouped ciphertext `(C, D_member, D_auditor)` — never plaintext.
    pub ciphertext: [u8; 96],
    pub slot: u64,
    pub bump: u8,
}

/// Parameters of `initialize`.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    pub keeper: Pubkey,
    pub oracle_program: Pubkey,
    pub registry_program: Pubkey,
    pub auditor_elgamal_pubkey: [u8; 32],
    pub cusdc_mint: Pubkey,
    pub cstock_mint: Pubkey,
    pub epoch_slots: u64,
    pub keeper_grace_slots: u64,
    pub stale_after_slots: u64,
    pub s_min: u64,
    pub max_bids_per_epoch: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_layout_is_padding_free_and_under_the_init_limit() {
        assert_eq!(
            core::mem::size_of::<Epoch>(),
            8 + 8 + 8 + 32 + 2368 + 2368 + 296 + 4 + 1 + 1 + 2
        );
        const _: () = assert!(Epoch::SPACE <= 10_240, "Epoch must fit a single-instruction init");
    }
}
