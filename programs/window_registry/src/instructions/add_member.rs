use anchor_lang::prelude::*;

use crate::{
    errors::RegistryError,
    events::MemberAdded,
    seeds,
    state::{Config, Member},
};

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct AddMember<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ RegistryError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Member::INIT_SPACE, seeds = [seeds::MEMBER, owner.as_ref()], bump)]
    pub member: Account<'info, Member>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(
    ctx: Context<AddMember>,
    owner: Pubkey,
    elgamal_pubkey: [u8; 32],
    joined_epoch: u64,
) -> Result<()> {
    require!(elgamal_pubkey != [0u8; 32], RegistryError::ZeroKey);
    let member = &mut ctx.accounts.member;
    member.owner = owner;
    member.elgamal_pubkey = elgamal_pubkey;
    member.joined_epoch = joined_epoch;
    member.active = true;
    member.bump = ctx.bumps.member;
    let config = &mut ctx.accounts.config;
    config.member_count =
        config.member_count.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    emit!(MemberAdded { owner, joined_epoch });
    Ok(())
}
