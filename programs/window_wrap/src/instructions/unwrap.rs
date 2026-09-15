use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::{errors::WrapError, events::Unwrapped, seeds, state::Vault};

#[derive(Accounts)]
pub struct Unwrap<'info> {
    #[account(mut)]
    pub member: Signer<'info>,
    #[account(mut, seeds = [seeds::VAULT, vault.mock_mint.as_ref()], bump = vault.bump, has_one = mock_mint, has_one = cstock_mint, has_one = custody)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mint::token_program = token_program)]
    pub mock_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, mint::token_program = token_program)]
    pub cstock_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mock_mint, token::authority = member, token::token_program = token_program)]
    pub member_mock: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mock_mint, token::token_program = token_program)]
    pub custody: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = cstock_mint, token::authority = member, token::token_program = token_program)]
    pub member_cstock: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub(crate) fn handler(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
    require!(amount > 0, WrapError::AmountZero);
    require!(ctx.accounts.member_cstock.amount >= amount, WrapError::InsufficientPublicBalance);
    let decimals = ctx.accounts.vault.decimals;
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.cstock_mint.to_account_info(),
                from: ctx.accounts.member_cstock.to_account_info(),
                authority: ctx.accounts.member.to_account_info(),
            },
        ),
        amount,
    )?;
    let mock_mint = ctx.accounts.vault.mock_mint;
    let bump = ctx.accounts.vault.bump;
    let signer: &[&[&[u8]]] = &[&[seeds::VAULT, mock_mint.as_ref(), &[bump]]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.custody.to_account_info(),
                mint: ctx.accounts.mock_mint.to_account_info(),
                to: ctx.accounts.member_mock.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        ),
        amount,
        decimals,
    )?;
    let vault = &mut ctx.accounts.vault;
    vault.wrapped = vault.wrapped.checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?;
    emit!(Unwrapped { member: ctx.accounts.member.key() });
    Ok(())
}
