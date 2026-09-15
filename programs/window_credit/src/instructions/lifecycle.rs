use anchor_lang::prelude::*;

use crate::{
    errors::CreditError,
    events::LoanStatusChanged,
    seeds,
    state::{Config, Loan, LoanStatus, PriceCache},
};

#[derive(Accounts)]
pub struct ConfirmLock<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = operator @ CreditError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub loan: Account<'info, Loan>,
}

pub(crate) fn confirm_lock(ctx: Context<ConfirmLock>) -> Result<()> {
    let loan = &mut ctx.accounts.loan;
    require!(loan.status() == Some(LoanStatus::Deposited), CreditError::NotDeposited);
    loan.status = LoanStatus::Locked as u8;
    emit!(LoanStatusChanged { loan: loan.key(), status: loan.status });
    Ok(())
}

#[derive(Accounts)]
pub struct ConfirmFunding<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ CreditError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub loan: Account<'info, Loan>,
}

pub(crate) fn confirm_funding(ctx: Context<ConfirmFunding>) -> Result<()> {
    let loan = &mut ctx.accounts.loan;
    require!(loan.status() == Some(LoanStatus::Locked), CreditError::NotLocked);
    let slot = Clock::get()?.slot;
    loan.funded_slot = slot;
    loan.deadline_slot = slot
        .checked_add(ctx.accounts.config.tenor_slots)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    loan.status = LoanStatus::Active as u8;
    emit!(LoanStatusChanged { loan: loan.key(), status: loan.status });
    Ok(())
}

#[derive(Accounts)]
pub struct Repay<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ CreditError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub loan: Account<'info, Loan>,
}

pub(crate) fn repay(ctx: Context<Repay>) -> Result<()> {
    let loan = &mut ctx.accounts.loan;
    require!(loan.status() == Some(LoanStatus::Active), CreditError::NotActive);
    loan.status = LoanStatus::Repaid as u8;
    emit!(LoanStatusChanged { loan: loan.key(), status: loan.status });
    Ok(())
}

#[derive(Accounts)]
pub struct Seize<'info> {
    pub anyone: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [seeds::PRICE, config.feed_id.as_ref()], bump = price_cache.bump)]
    pub price_cache: Account<'info, PriceCache>,
    #[account(mut)]
    pub loan: Account<'info, Loan>,
}

pub(crate) fn seize(ctx: Context<Seize>) -> Result<()> {
    let loan = &mut ctx.accounts.loan;
    require!(loan.status() == Some(LoanStatus::Active), CreditError::NotActive);
    let slot = Clock::get()?.slot;
    require!(slot > loan.deadline_slot, CreditError::NotMatured);
    // Safety degrades to inaction: a stale price cannot seize.
    require!(
        slot.saturating_sub(ctx.accounts.price_cache.posted_slot)
            <= ctx.accounts.config.max_price_age,
        CreditError::PriceStale
    );
    loan.status = LoanStatus::Defaulted as u8;
    emit!(LoanStatusChanged { loan: loan.key(), status: loan.status });
    Ok(())
}
