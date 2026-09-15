use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};
use spl_token_2022_interface::extension::confidential_transfer::instruction as ct;
use window_registry::state::Member;

use crate::{errors::WrapError, events::Wrapped, seeds, state::Vault};

#[derive(Accounts)]
pub struct Wrap<'info> {
    #[account(mut)]
    pub member: Signer<'info>,
    #[account(
        seeds = [window_registry::seeds::MEMBER, member.key().as_ref()],
        bump = member_record.bump,
        seeds::program = vault.registry_program,
        constraint = member_record.owner == member.key() @ WrapError::Unauthorized,
        constraint = member_record.active @ WrapError::MemberInactive,
    )]
    pub member_record: Account<'info, Member>,
    #[account(mut, seeds = [seeds::VAULT, vault.mock_mint.as_ref()], bump = vault.bump, has_one = mock_mint, has_one = cstock_mint, has_one = custody)]
    pub vault: Account<'info, Vault>,
    #[account(mint::token_program = token_program)]
    pub mock_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, mint::token_program = token_program)]
    pub cstock_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mock_mint, token::authority = member, token::token_program = token_program)]
    pub member_mock: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mock_mint, token::token_program = token_program)]
    pub custody: InterfaceAccount<'info, TokenAccount>,
    /// The member's cSTOCK-W account with the confidential-transfer extension configured.
    #[account(mut, token::mint = cstock_mint, token::authority = member, token::token_program = token_program)]
    pub member_cstock: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: PDA mint authority.
    #[account(seeds = [seeds::MINT_AUTHORITY], bump = vault.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub(crate) fn handler(ctx: Context<Wrap>, amount: u64) -> Result<()> {
    require!(amount > 0, WrapError::AmountZero);
    let decimals = ctx.accounts.vault.decimals;
    // 1. mock-xStock → custody (extensions respected).
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.member_mock.to_account_info(),
                mint: ctx.accounts.mock_mint.to_account_info(),
                to: ctx.accounts.custody.to_account_info(),
                authority: ctx.accounts.member.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;
    // 2. mint cSTOCK-W 1:1 to the member's public balance.
    let bump = ctx.accounts.vault.mint_authority_bump;
    let signer: &[&[&[u8]]] = &[&[seeds::MINT_AUTHORITY, &[bump]]];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.cstock_mint.to_account_info(),
                to: ctx.accounts.member_cstock.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;
    // 3. public → pending confidential balance (owner-signed; no proof required).
    let ix = ct::deposit(
        ctx.accounts.token_program.key,
        &ctx.accounts.member_cstock.key(),
        &ctx.accounts.cstock_mint.key(),
        amount,
        decimals,
        &ctx.accounts.member.key(),
        &[],
    )?;
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.member_cstock.to_account_info(),
            ctx.accounts.cstock_mint.to_account_info(),
            ctx.accounts.member.to_account_info(),
        ],
    )?;
    let vault = &mut ctx.accounts.vault;
    vault.wrapped = vault.wrapped.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
    emit!(Wrapped { member: ctx.accounts.member.key() });
    Ok(())
}
