use anchor_lang::prelude::*;

use crate::{errors::RegistryError, events::MemberKeyUpdated, seeds, state::Member};

#[derive(Accounts)]
pub struct UpdateElgamalPubkey<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [seeds::MEMBER, owner.key().as_ref()], bump = member.bump, has_one = owner @ RegistryError::Unauthorized)]
    pub member: Account<'info, Member>,
}

pub(crate) fn handler(ctx: Context<UpdateElgamalPubkey>, new_pubkey: [u8; 32]) -> Result<()> {
    require!(new_pubkey != [0u8; 32], RegistryError::ZeroKey);
    require!(ctx.accounts.member.active, RegistryError::NotActive);
    ctx.accounts.member.elgamal_pubkey = new_pubkey;
    emit!(MemberKeyUpdated { owner: ctx.accounts.owner.key() });
    Ok(())
}
