use anchor_lang::prelude::*;

use crate::{
    errors::RegistryError,
    events::MemberRemoved,
    seeds,
    state::{Config, Member},
};

#[derive(Accounts)]
pub struct RemoveMember<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ RegistryError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [seeds::MEMBER, member.owner.as_ref()], bump = member.bump)]
    pub member: Account<'info, Member>,
}

pub(crate) fn handler(ctx: Context<RemoveMember>) -> Result<()> {
    let member = &mut ctx.accounts.member;
    require!(member.active, RegistryError::NotActive);
    member.active = false;
    emit!(MemberRemoved { owner: member.owner });
    Ok(())
}
