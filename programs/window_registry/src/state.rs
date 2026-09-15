use anchor_lang::prelude::*;

/// Registry configuration.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub member_count: u64,
    pub bump: u8,
}

/// One registered member.
#[account]
#[derive(InitSpace)]
pub struct Member {
    pub owner: Pubkey,
    /// Compressed Ristretto ElGamal public key; bids must carry a handle under it.
    pub elgamal_pubkey: [u8; 32],
    pub joined_epoch: u64,
    pub active: bool,
    pub bump: u8,
}
