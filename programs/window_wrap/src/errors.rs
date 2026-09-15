use anchor_lang::prelude::*;

#[error_code]
pub enum WrapError {
    #[msg("signer is not authorized")]
    Unauthorized,
    #[msg("mint configuration does not match the wrapper's requirements")]
    BadMintConfig,
    #[msg("member is not active")]
    MemberInactive,
    #[msg("amount must be > 0")]
    AmountZero,
    #[msg("insufficient public cSTOCK-W balance")]
    InsufficientPublicBalance,
}
