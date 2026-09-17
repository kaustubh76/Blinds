use anchor_lang::prelude::*;

#[event]
pub struct PricePosted {
    pub feed_id: [u8; 32],
    pub price: u64,
    pub expo: i32,
    pub publish_time: i64,
}

/// No sizes.
#[event]
pub struct MatchPosted {
    pub loan: Pubkey,
    pub epoch: u64,
    pub tick: u8,
    pub borrower: Pubkey,
    pub lender: Pubkey,
}

#[event]
pub struct LockRequested {
    pub loan: Pubkey,
    pub price_at_lock: u64,
    pub mult_at_lock: u64,
    pub listing: Pubkey,
}

#[event]
pub struct ListingAdded {
    pub listing: Pubkey,
    pub cstock_mint: Pubkey,
    pub feed_id: [u8; 32],
}

#[event]
pub struct LoanStatusChanged {
    pub loan: Pubkey,
    pub status: u8,
}

#[event]
pub struct CollateralReleased {
    pub loan: Pubkey,
    pub to: Pubkey,
}
