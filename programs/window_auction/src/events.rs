use anchor_lang::prelude::*;

#[event]
pub struct EpochOpened {
    pub index: u64,
    pub start_slot: u64,
}

#[event]
pub struct EpochClosed {
    pub index: u64,
    pub close_slot: u64,
}

/// No size. Ever.
#[event]
pub struct BidSubmitted {
    pub epoch: u64,
    pub member: Pubkey,
    pub side: u8,
    pub tick: u8,
}

#[event]
pub struct EpochPrinted {
    pub index: u64,
    pub outcome: u8,
}

#[event]
pub struct AuditorRotated {
    pub epochs_opened: u64,
}
