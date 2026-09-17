//! Brings a `Loan` written before the collateral schedule (no `listing` field, 32 bytes shorter) to
//! the current layout. Admin-only; idempotent in effect because a loan of the current size is refused.

use anchor_lang::prelude::*;

use crate::{
    errors::CreditError,
    seeds,
    state::{Config, Listing, Loan, LEGACY_LOAN_LEN},
};

#[derive(Accounts)]
pub struct MigrateLoan<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ CreditError::Unauthorized)]
    pub config: Account<'info, Config>,
    /// The listing that mirrors the original collateral: its cSTOCK mint is `config.cstock_mint`.
    #[account(
        seeds = [seeds::LISTING, listing.cstock_mint.as_ref()],
        bump = listing.bump,
        constraint = listing.cstock_mint == config.cstock_mint @ CreditError::WrongListing,
    )]
    pub listing: Account<'info, Listing>,
    /// CHECK: a pre-listing `Loan`; discriminator and length are checked in the handler before it is resized.
    #[account(mut, owner = crate::ID)]
    pub loan: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<MigrateLoan>) -> Result<()> {
    let loan = ctx.accounts.loan.to_account_info();
    {
        let data = loan.try_borrow_data()?;
        require!(data.len() == LEGACY_LOAN_LEN, CreditError::BadParams);
        require!(data[..8] == Loan::DISCRIMINATOR[..], CreditError::BadParams);
    }
    let new_len = 8 + Loan::INIT_SPACE;
    let needed = Rent::get()?.minimum_balance(new_len);
    let top_up = needed.saturating_sub(loan.lamports());
    if top_up > 0 {
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.admin.key(),
            &loan.key(),
            top_up,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.admin.to_account_info(),
                loan.clone(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }
    loan.resize(new_len)?;
    let mut data = loan.try_borrow_mut_data()?;
    data[LEGACY_LOAN_LEN..new_len].copy_from_slice(&ctx.accounts.listing.key().to_bytes());
    Ok(())
}
