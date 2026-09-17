use anchor_lang::prelude::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug, AnchorSerialize, AnchorDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum LoanStatus {
    Pending = 1,
    Requested = 2,
    Deposited = 3,
    Locked = 4,
    Active = 5,
    Repaid = 6,
    Defaulted = 7,
}

impl LoanStatus {
    pub const fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Pending),
            2 => Some(Self::Requested),
            3 => Some(Self::Deposited),
            4 => Some(Self::Locked),
            5 => Some(Self::Active),
            6 => Some(Self::Repaid),
            7 => Some(Self::Defaulted),
            _ => None,
        }
    }
}

/// How a loan's size ciphertext is established.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub enum MatchKind {
    /// The borrower's whole bid: `size_ct` is copied from the `Bid` account (program-enforced).
    Full,
    /// A bid split across lenders: a fresh ciphertext, bound to the borrower and auditor keys by
    /// the validity proof in `partial_validity_ctx`, plus the Pedersen opening sealed to the
    /// borrower (ECDH one-time pad, see `window_elgamal::note`) so it can prove solvency for it.
    /// Correctness of the split is attested.
    Partial { size_ct: [u8; 96], opening_note: [u8; 32] },
}

/// The frozen deployment-wide configuration. Written once at `initialize`. The collateral fields
/// (`cstock_mint`, `mock_mint`, `escrow_account`, `feed_id`, `haircut_bps`, `max_price_age`) describe
/// the desk's original collateral; since the collateral schedule they are mirrored by listing #0 and
/// no instruction reads them for pricing any more.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub keeper: Pubkey,
    pub oracle_program: Pubkey,
    pub auction_program: Pubkey,
    pub registry_program: Pubkey,
    pub cstock_mint: Pubkey,
    pub mock_mint: Pubkey,
    /// The operator's cSTOCK-W confidential account holding escrowed collateral.
    pub escrow_account: Pubkey,
    pub feed_id: [u8; 32],
    pub haircut_bps: u64,
    pub max_price_age: u64,
    pub tenor_slots: u64,
    /// 0 = read the multiplier from the mint's `ScaledUiAmount` extension.
    pub multiplier_override: u64,
    pub bump: u8,
}

/// One eligible collateral. `["listing", cstock_mint]`. The rate is one benchmark; each listing
/// carries its own price source, haircut and freshness limits, and its own `PriceCache`.
#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub mock_mint: Pubkey,
    pub cstock_mint: Pubkey,
    /// The operator's confidential cSTOCK account holding this listing's escrowed collateral.
    pub escrow_account: Pubkey,
    /// A Pyth feed id for a Pyth-marked listing; `sha256("<source>:<symbol>")` for an attested
    /// mark — a label, never a Pyth id; all-zero for the documented local mock walk.
    pub feed_id: [u8; 32],
    /// 0 = Pyth · 1 = Tessera mark · 2 = PreStocks mark · 3 = mock walk.
    pub price_source: u8,
    /// Collateral value must cover this many bps of the loan.
    pub haircut_bps: u64,
    /// Keeper liveness: `slot − price_cache.posted_slot` must not exceed this.
    pub max_price_age: u64,
    /// Quote liveness: `now − price_cache.publish_time` must not exceed this.
    pub max_publish_age_secs: i64,
    /// UTF-8 label, zero padded.
    pub symbol: [u8; 16],
    pub decimals: u8,
    pub bump: u8,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct ListingParams {
    pub feed_id: [u8; 32],
    pub price_source: u8,
    pub haircut_bps: u64,
    pub max_price_age: u64,
    pub max_publish_age_secs: i64,
    pub symbol: [u8; 16],
}

pub const PRICE_SOURCE_PYTH: u8 = 0;
pub const PRICE_SOURCE_MOCK: u8 = 3;
pub const PRICE_SOURCE_MAX: u8 = 3;

#[account]
#[derive(InitSpace)]
pub struct PriceCache {
    pub feed_id: [u8; 32],
    pub price: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub posted_slot: u64,
    pub posts: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub lender: Pubkey,
    pub borrower: Pubkey,
    pub epoch: u64,
    /// The clearing rate tick.
    pub tick: u8,
    /// The borrower's bid tick (≥ `tick`).
    pub bid_tick: u8,
    pub k: u8,
    /// `LoanStatus` discriminant.
    pub status: u8,
    pub collateral_released: bool,
    /// Disclosed marginal ratio for this lender's fill (1/1 for a full fill).
    pub fill_num: u64,
    pub fill_den: u64,
    /// Grouped (borrower, auditor) ciphertext of the loan size — never plaintext.
    pub size_ct: [u8; 96],
    /// Grouped (borrower, auditor) ciphertext of the collateral shares — never plaintext.
    pub collateral_ct: [u8; 96],
    /// Pedersen commitment to Δ recorded at lock.
    pub delta_commitment: [u8; 32],
    /// For partial fills: the size ciphertext's opening, sealed to the borrower. Zero for full fills.
    pub opening_note: [u8; 32],
    pub k_c: u64,
    pub k_l: u64,
    pub price_at_lock: u64,
    pub mult_at_lock: u64,
    pub lock_slot: u64,
    pub funded_slot: u64,
    pub deadline_slot: u64,
    pub bump: u8,
    /// The `Listing` the collateral was locked under (default until `lock_collateral`). Appended
    /// after `bump` so every earlier offset is unchanged; pre-listing loans are 32 bytes shorter
    /// and are brought to this layout by `migrate_loan`.
    pub listing: Pubkey,
}

/// Size of a `Loan` account written before the collateral schedule (no `listing` field).
pub const LEGACY_LOAN_LEN: usize = 8 + Loan::INIT_SPACE - 32;

impl Loan {
    pub fn status(&self) -> Option<LoanStatus> {
        LoanStatus::from_u8(self.status)
    }
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    pub operator: Pubkey,
    pub keeper: Pubkey,
    pub oracle_program: Pubkey,
    pub auction_program: Pubkey,
    pub registry_program: Pubkey,
    pub cstock_mint: Pubkey,
    pub mock_mint: Pubkey,
    pub escrow_account: Pubkey,
    pub feed_id: [u8; 32],
    pub haircut_bps: u64,
    pub max_price_age: u64,
    pub tenor_slots: u64,
    pub multiplier_override: u64,
}
