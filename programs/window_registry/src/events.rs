use anchor_lang::prelude::*;

#[event]
pub struct MemberAdded {
    pub owner: Pubkey,
    pub joined_epoch: u64,
}

#[event]
pub struct MemberRemoved {
    pub owner: Pubkey,
}

#[event]
pub struct MemberKeyUpdated {
    pub owner: Pubkey,
}
