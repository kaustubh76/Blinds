//! Client-side view of the five programs: PDA derivations, instruction builders (pure functions
//! of public keys and arguments) and account decoding. No RPC, no signing — the admin service,
//! the agents and the LiteSVM harness all build transactions from here.

pub mod accounts;
pub mod ct;
pub mod ix;
pub mod pda;

pub use window_auction::state::{Bid, Config as AuctionConfig, Epoch, EpochStatus};
pub use window_credit::state::{
    Config as CreditConfig, InitializeParams as CreditInitializeParams, Listing, ListingParams,
    Loan, LoanStatus, MatchKind, PriceCache, LEGACY_LOAN_LEN, PRICE_SOURCE_MOCK, PRICE_SOURCE_PYTH,
};
/// Bitmap helpers for `Print.{nonzero,proven}_bitmap`.
pub mod print_bits {
    pub use window_oracle::state::{bit_index, get_bit, set_bit};
}
pub use window_oracle::state::{OracleState, Print, PrintStatus, TickClaim};
pub use window_registry::state::Member;
pub use window_wrap::state::Vault;

/// Program ids.
pub mod programs {
    use solana_pubkey::Pubkey;
    pub const REGISTRY: Pubkey = window_registry::ID;
    pub const AUCTION: Pubkey = window_auction::ID;
    pub const ORACLE: Pubkey = window_oracle::ID;
    pub const WRAP: Pubkey = window_wrap::ID;
    pub const CREDIT: Pubkey = window_credit::ID;
    pub fn all() -> [Pubkey; 5] {
        [REGISTRY, AUCTION, ORACLE, WRAP, CREDIT]
    }
}

/// Auction `InitializeParams` from a config profile.
pub fn auction_params(
    profile: &window_config::Profile,
    keeper: &solana_pubkey::Pubkey,
    auditor_elgamal_pubkey: [u8; 32],
    cusdc_mint: solana_pubkey::Pubkey,
    cstock_mint: solana_pubkey::Pubkey,
) -> window_auction::state::InitializeParams {
    {
        window_auction::state::InitializeParams {
            keeper: *keeper,
            oracle_program: programs::ORACLE,
            registry_program: programs::REGISTRY,
            auditor_elgamal_pubkey,
            cusdc_mint,
            cstock_mint,
            epoch_slots: profile.market.epoch_slots,
            keeper_grace_slots: profile.market.keeper_grace_slots,
            stale_after_slots: profile.market.stale_after_slots,
            s_min: profile.market.bid_min_micro_usdc,
            max_bids_per_epoch: profile.market.max_bids_per_epoch,
        }
    }
}
