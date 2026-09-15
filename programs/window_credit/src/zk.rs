use anchor_lang::prelude::*;
use solana_zk_sdk::zk_elgamal_proof_program::{
    instruction::{close_context_state, ContextStateInfo},
    state::ProofContextStateMeta,
};

use crate::errors::CreditError;

pub fn zk_program_id() -> Pubkey {
    solana_zk_sdk::zk_elgamal_proof_program::id()
}

pub fn require_context_authority(ctx: &AccountInfo, authority: &Pubkey) -> Result<()> {
    require_keys_eq!(*ctx.owner, zk_program_id(), CreditError::BadContextOwner);
    let data = ctx.try_borrow_data()?;
    let meta = ProofContextStateMeta::try_from_bytes(&data)
        .map_err(|_| error!(CreditError::WrongProofType))?;
    require_keys_eq!(
        meta.context_state_authority,
        *authority,
        CreditError::ContextAuthorityMismatch
    );
    Ok(())
}

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

/// Token-2022 `ConfidentialTransferExtension` / `Transfer` discriminators.
pub const TOKEN_CT_EXTENSION: u8 = 27;
pub const CT_TRANSFER: u8 = 7;

/// Requires the instruction at relative offset −1 to be a Token-2022 confidential `Transfer`
/// from `source` to `destination`.
pub fn require_previous_is_ct_transfer(
    instructions: &AccountInfo,
    source: &Pubkey,
    destination: &Pubkey,
) -> Result<()> {
    let ix = solana_instructions_sysvar::get_instruction_relative(-1, instructions)
        .map_err(|_| error!(CreditError::NoEscrowTransfer))?;
    let token_2022 = spl_token_2022_interface::id();
    require_keys_eq!(ix.program_id, token_2022, CreditError::NoEscrowTransfer);
    require!(
        ix.data.len() >= 2 && ix.data[0] == TOKEN_CT_EXTENSION && ix.data[1] == CT_TRANSFER,
        CreditError::NoEscrowTransfer
    );
    require!(ix.accounts.len() >= 3, CreditError::NoEscrowTransfer);
    require_keys_eq!(ix.accounts[0].pubkey, *source, CreditError::NoEscrowTransfer);
    require_keys_eq!(ix.accounts[2].pubkey, *destination, CreditError::NoEscrowTransfer);
    Ok(())
}
