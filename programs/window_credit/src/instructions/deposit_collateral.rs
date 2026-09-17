use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    errors::CreditError,
    events::LoanStatusChanged,
    seeds,
    state::{Config, Listing, Loan, LoanStatus},
    zk,
};

/// Transaction shape: `[Token-2022 confidential Transfer (borrower → escrow), deposit_collateral]`.
#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    pub borrower: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = borrower @ CreditError::Unauthorized)]
    pub loan: Box<Account<'info, Loan>>,
    #[account(address = loan.listing @ CreditError::WrongListing)]
    pub listing: Box<Account<'info, Listing>>,
    #[account(token::mint = listing.cstock_mint, token::authority = borrower)]
    pub borrower_cstock: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Instructions sysvar, address-checked.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub(crate) fn handler(ctx: Context<DepositCollateral>) -> Result<()> {
    let loan = &mut ctx.accounts.loan;
    require!(loan.status() == Some(LoanStatus::Requested), CreditError::NotRequested);
    zk::require_previous_is_ct_transfer(
        &ctx.accounts.instructions.to_account_info(),
        &ctx.accounts.borrower_cstock.key(),
        &ctx.accounts.listing.escrow_account,
    )?;
    loan.status = LoanStatus::Deposited as u8;
    emit!(LoanStatusChanged { loan: loan.key(), status: loan.status });
    Ok(())
}
