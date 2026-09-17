use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    errors::CreditError,
    events::CollateralReleased,
    seeds,
    state::{Config, Listing, Loan, LoanStatus},
    zk,
};

/// Transaction shape: `[Token-2022 confidential Transfer (escrow → destination), release_collateral]`.
/// Repaid → the borrower's account; Defaulted → the lender's account.
#[derive(Accounts)]
pub struct ReleaseCollateral<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = operator @ CreditError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub loan: Box<Account<'info, Loan>>,
    #[account(address = loan.listing @ CreditError::WrongListing)]
    pub listing: Box<Account<'info, Listing>>,
    #[account(token::mint = listing.cstock_mint)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Instructions sysvar, address-checked.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub(crate) fn handler(ctx: Context<ReleaseCollateral>) -> Result<()> {
    let loan = &mut ctx.accounts.loan;
    require!(!loan.collateral_released, CreditError::AlreadyReleased);
    let expected_owner = match loan.status() {
        Some(LoanStatus::Repaid) => loan.borrower,
        Some(LoanStatus::Defaulted) => loan.lender,
        _ => return err!(CreditError::NotTerminal),
    };
    require_keys_eq!(ctx.accounts.destination.owner, expected_owner, CreditError::WrongDestination);
    zk::require_previous_is_ct_transfer(
        &ctx.accounts.instructions.to_account_info(),
        &ctx.accounts.listing.escrow_account,
        &ctx.accounts.destination.key(),
    )
    .map_err(|_| error!(CreditError::NoReleaseTransfer))?;
    loan.collateral_released = true;
    emit!(CollateralReleased { loan: loan.key(), to: ctx.accounts.destination.key() });
    Ok(())
}
