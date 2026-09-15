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
