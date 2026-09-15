//! Proof-context consumption shared by the instructions.

use anchor_lang::prelude::*;
use solana_zk_sdk::zk_elgamal_proof_program::{
    instruction::{close_context_state, ContextStateInfo},
    state::ProofContextStateMeta,
};

use crate::errors::AuctionError;

/// The ZK ElGamal Proof program id.
pub fn zk_program_id() -> Pubkey {
    solana_zk_sdk::zk_elgamal_proof_program::id()
}

/// Requires a context-state account to be owned by the ZK program and to have `authority` as
/// its close authority (the extraction helper checks owner and proof type, not the authority).
pub fn require_context_authority(ctx: &AccountInfo, authority: &Pubkey) -> Result<()> {
    require_keys_eq!(*ctx.owner, zk_program_id(), AuctionError::BadContextOwner);
    let data = ctx.try_borrow_data()?;
    let meta = ProofContextStateMeta::try_from_bytes(&data)
        .map_err(|_| error!(AuctionError::WrongProofType))?;
    require_keys_eq!(
        meta.context_state_authority,
        *authority,
        AuctionError::ContextAuthorityMismatch
    );
    Ok(())
}

/// Closes a context-state account by CPI; `authority` must be a signer of the outer
/// transaction (its signature propagates). Lamports go to `authority`.
pub fn close_context<'info>(
    ctx: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
) -> Result<()> {
    let ix = close_context_state(
        ContextStateInfo { context_state_account: ctx.key, context_state_authority: authority.key },
        authority.key,
    );
    anchor_lang::solana_program::program::invoke(&ix, &[ctx.clone(), authority.clone()])?;
    Ok(())
}
