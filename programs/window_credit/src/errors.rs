use anchor_lang::prelude::*;

#[error_code]
pub enum CreditError {
    #[msg("signer is not authorized")]
    Unauthorized,
    #[msg("invalid parameters")]
    BadParams,
    #[msg("price must be > 0")]
    BadPrice,
    #[msg("publish_time went backwards")]
    PriceRegressed,
    #[msg("epoch is not printed")]
    NotPrinted,
    #[msg("bid side does not match its role in the loan")]
    WrongSide,
    #[msg("bid tick is not filled at the clearing rate")]
    TickNotFilled,
    #[msg("partial fill requires a validity proof context")]
    BadPartialProof,
    #[msg("loan is not pending")]
    NotPending,
    #[msg("loan is not requested")]
    NotRequested,
    #[msg("loan is not deposited")]
    NotDeposited,
    #[msg("loan is not locked")]
    NotLocked,
    #[msg("loan is not active")]
    NotActive,
    #[msg("loan has not matured")]
    NotMatured,
    #[msg("loan is not in a terminal state")]
    NotTerminal,
    #[msg("collateral already released")]
    AlreadyReleased,
    #[msg("price is stale")]
    PriceStale,
    #[msg("solvency scalars violate the soundness bound")]
    ScalarBound,
    #[msg("multiplier is invalid")]
    MultiplierInvalid,
    #[msg("proof is not under the borrower's registered ElGamal key")]
    MemberKeyMismatch,
    #[msg("proof is not under the auditor key")]
    AuditorKeyMismatch,
    #[msg("collateral range proof does not cover the collateral commitment with 32 bits")]
    CollateralRangeMismatch,
    #[msg("equality proof is not over E_delta")]
    DeltaMismatch,
    #[msg("delta range proof does not cover the delta commitment with 64 bits")]
    DeltaRangeMismatch,
    #[msg("proof context authority is not the borrower")]
    ContextAuthorityMismatch,
    #[msg("proof context account is not owned by the ZK ElGamal proof program")]
    BadContextOwner,
    #[msg("wrong proof type")]
    WrongProofType,
    #[msg("the previous instruction is not a confidential transfer into escrow")]
    NoEscrowTransfer,
    #[msg("the previous instruction is not a confidential transfer out of escrow to the right account")]
    NoReleaseTransfer,
    #[msg("curve operation failed")]
    CurveError,
    #[msg("wrong destination for the collateral release")]
    WrongDestination,
    #[msg("the quote's own publish_time is older than the listing allows")]
    QuoteStale,
    #[msg("publish_time is in the future")]
    PublishTimeAhead,
    #[msg("account is not the loan's listing")]
    WrongListing,
}
