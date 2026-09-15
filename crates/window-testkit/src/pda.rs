//! PDA derivations mirroring the programs' seeds.

use solana_pubkey::Pubkey;

pub fn registry_config() -> Pubkey {
    Pubkey::find_program_address(&[window_registry::seeds::CONFIG], &window_registry::ID).0
}
pub fn member(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[window_registry::seeds::MEMBER, owner.as_ref()],
        &window_registry::ID,
    )
    .0
}
pub fn auction_config() -> Pubkey {
    Pubkey::find_program_address(&[window_auction::seeds::CONFIG], &window_auction::ID).0
}
pub fn epoch(index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[window_auction::seeds::EPOCH, &index.to_le_bytes()],
        &window_auction::ID,
    )
    .0
}
pub fn bid(epoch: u64, member: &Pubkey, side: u8, tick: u8) -> Pubkey {
    Pubkey::find_program_address(
        &[window_auction::seeds::BID, &epoch.to_le_bytes(), member.as_ref(), &[side], &[tick]],
        &window_auction::ID,
    )
    .0
}
pub fn oracle_state() -> Pubkey {
    Pubkey::find_program_address(&[window_oracle::seeds::ORACLE], &window_oracle::ID).0
}
pub fn print(index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[window_oracle::seeds::PRINT, &index.to_le_bytes()],
        &window_oracle::ID,
    )
    .0
}
pub fn oracle_authority() -> Pubkey {
    Pubkey::find_program_address(&[window_oracle::seeds::AUTHORITY], &window_oracle::ID).0
}

/// `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
pub const ASSOCIATED_TOKEN_PROGRAM: Pubkey =
    Pubkey::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), spl_token_2022_interface::id().as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM,
    )
    .0
}
pub fn wrap_vault(mock_mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[window_wrap::seeds::VAULT, mock_mint.as_ref()], &window_wrap::ID)
        .0
}
pub fn wrap_mint_authority() -> Pubkey {
    Pubkey::find_program_address(&[window_wrap::seeds::MINT_AUTHORITY], &window_wrap::ID).0
}
pub fn credit_config() -> Pubkey {
    Pubkey::find_program_address(&[window_credit::seeds::CONFIG], &window_credit::ID).0
}
pub fn price_cache(feed_id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[window_credit::seeds::PRICE, feed_id], &window_credit::ID).0
}
pub fn loan(epoch: u64, borrower: &Pubkey, bid_tick: u8, k: u8) -> Pubkey {
    Pubkey::find_program_address(
        &[window_credit::seeds::LOAN, &epoch.to_le_bytes(), borrower.as_ref(), &[bid_tick], &[k]],
        &window_credit::ID,
    )
    .0
}
