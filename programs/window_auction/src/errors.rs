use anchor_lang::prelude::*;

#[error_code]
pub enum AuctionError {
    #[msg("signer is not authorized for this instruction")]
    Unauthorized,
    #[msg("invalid parameters")]
    BadParams,
    #[msg("the previous epoch is still open")]
    PrevEpochStillOpen,
    #[msg("epoch is not open")]
    NotOpen,
    #[msg("epoch is not closed")]
    NotClosed,
    #[msg("epoch window has not elapsed")]
    WindowNotElapsed,
    #[msg("only the keeper may close before the grace period")]
    NotKeeperBeforeGrace,
    #[msg("tick out of range")]
    BadTick,
    #[msg("side must be 0 (ask) or 1 (bid)")]
    BadSide,
    #[msg("member is not active")]
    MemberInactive,
    #[msg("validity proof is not under the member's registered ElGamal key")]
    MemberKeyMismatch,
    #[msg("validity proof is not under the epoch's auditor key")]
    AuditorKeyMismatch,
    #[msg("range proof commitment is not C - s_min*G")]
    RangeCommitmentMismatch,
    #[msg("range proof bit length is not 40")]
    RangeBitLength,
    #[msg("proof context authority is not the member")]
    ContextAuthorityMismatch,
    #[msg("proof context account is not owned by the ZK ElGamal proof program")]
    BadContextOwner,
    #[msg("wrong proof type or malformed proof instruction")]
    WrongProofType,
    #[msg("too many bids in this epoch")]
    TooManyBids,
    #[msg("curve operation failed")]
    CurveError,
    #[msg("epoch is not settled")]
    EpochNotSettled,
    #[msg("matching window has not passed")]
    MatchingWindowOpen,
    #[msg("cannot rotate the auditor while an epoch is open")]
    EpochOpen,
    #[msg("invalid print outcome")]
    BadOutcome,
    #[msg("epoch index mismatch")]
    EpochIndexMismatch,
}
