use anchor_lang::prelude::*;

#[error_code]
pub enum OracleError {
    #[msg("signer is not authorized")]
    Unauthorized,
    #[msg("epoch is not closed")]
    NotClosed,
    #[msg("a zero-count tick has a non-identity accumulator")]
    ZeroTickNotIdentity,
    #[msg("print already exists")]
    PrintExists,
    #[msg("print is not attesting")]
    PrintNotAttesting,
    #[msg("wrong proof type or malformed proof instruction")]
    WrongProofType,
    #[msg("proof is not under the epoch's auditor key")]
    ProofKeyMismatch,
    #[msg("proof ciphertext is not the residual of the accumulator and the claimed sum")]
    ResidualMismatch,
    #[msg("claimed sum exceeds bid_count * 2^40")]
    SumExceedsBound,
    #[msg("tick has no bids; nothing to attest")]
    TickNotNonzero,
    #[msg("tick already attested")]
    TickAlreadyAttested,
    #[msg("not every nonzero tick is proven")]
    CoverageIncomplete,
    #[msg("recomputed clearing rate differs from the claim")]
    RateMismatch,
    #[msg("print already finalized")]
    AlreadyFinalized,
    #[msg("print deadline has not passed")]
    NotYetStale,
    #[msg("bad side or tick")]
    BadTick,
    #[msg("too many claims in one instruction")]
    TooManyClaims,
    #[msg("epoch index mismatch")]
    EpochIndexMismatch,
    #[msg("clearing arithmetic overflow")]
    Overflow,
    #[msg("curve operation failed")]
    CurveError,
}
