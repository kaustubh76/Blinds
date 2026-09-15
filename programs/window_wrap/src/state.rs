use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub admin: Pubkey,
    pub registry_program: Pubkey,
    pub mock_mint: Pubkey,
    pub cstock_mint: Pubkey,
    /// Token-2022 account of `mock_mint` owned by this PDA.
    pub custody: Pubkey,
    /// Total mock-xStock in custody == cSTOCK-W supply.
    pub wrapped: u64,
    pub decimals: u8,
    pub bump: u8,
    pub mint_authority_bump: u8,
}
