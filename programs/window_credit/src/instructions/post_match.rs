use anchor_lang::prelude::*;
use bytemuck::bytes_of;
use solana_zk_sdk::zk_elgamal_proof_program::proof_data::{
    GroupedCiphertext2HandlesValidityProofContext, GroupedCiphertext2HandlesValidityProofData,
};
use spl_token_confidential_transfer_proof_extraction::instruction::verify_and_extract_context;
use window_auction::state::{Bid, Config as AuctionConfig};
use window_clearing::Side;
use window_oracle::state::{Print, PrintStatus};
use window_registry::state::Member;

use crate::{
    errors::CreditError,
    events::MatchPosted,
    seeds,
    state::{Config, Loan, LoanStatus, MatchKind},
    zk,
};

#[derive(Accounts)]
#[instruction(epoch: u64, k: u8)]
pub struct PostMatch<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ CreditError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [window_oracle::seeds::PRINT, &epoch.to_le_bytes()],
        bump = print.load()?.bump,
        seeds::program = config.oracle_program,
    )]
    pub print: AccountLoader<'info, Print>,
    #[account(seeds = [window_auction::seeds::CONFIG], bump = auction_config.bump, seeds::program = config.auction_program)]
    pub auction_config: Account<'info, AuctionConfig>,
    #[account(constraint = borrower_bid.epoch == epoch @ CreditError::NotPrinted)]
    pub borrower_bid: Account<'info, Bid>,
    #[account(constraint = lender_bid.epoch == epoch @ CreditError::NotPrinted)]
    pub lender_bid: Account<'info, Bid>,
    #[account(
        seeds = [window_registry::seeds::MEMBER, borrower_bid.member.as_ref()],
        bump = borrower_record.bump,
        seeds::program = config.registry_program,
    )]
    pub borrower_record: Account<'info, Member>,
    #[account(
        init,
        payer = admin,
        space = 8 + Loan::INIT_SPACE,
        seeds = [seeds::LOAN, &epoch.to_le_bytes(), borrower_bid.member.as_ref(), &[borrower_bid.tick], &[k]],
        bump
    )]
    pub loan: Account<'info, Loan>,
    /// CHECK: validity context for a `Partial` fill; owner/type checked in the handler.
    pub partial_validity_ctx: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<PostMatch>, epoch: u64, k: u8, kind: MatchKind) -> Result<()> {
    let print = ctx.accounts.print.load()?;
    require!(print.status() == Some(PrintStatus::Printed), CreditError::NotPrinted);
    let r_star = print.r_star_tick;
    let (marginal_tick, ratio) =
        (print.marginal_tick, (print.marginal_ratio_num, print.marginal_ratio_den));
    drop(print);

    let b = &ctx.accounts.borrower_bid;
    let l = &ctx.accounts.lender_bid;
    require!(b.side == Side::Bid as u8 && l.side == Side::Ask as u8, CreditError::WrongSide);
    // Bids at ≥ r* are filled (fully); asks at ≤ r* may be filled (marginal ones pro-rata).
    require!(
        b.tick >= r_star && l.tick <= r_star && l.tick <= marginal_tick,
        CreditError::TickNotFilled
    );

    let size_ct = match kind {
        MatchKind::Full => b.ciphertext,
        MatchKind::Partial { size_ct } => {
            let ctx_acc =
                ctx.accounts.partial_validity_ctx.as_ref().ok_or(CreditError::BadPartialProof)?;
            zk::require_context_authority(&ctx_acc.to_account_info(), &ctx.accounts.admin.key())?;
            let one = [ctx_acc.to_account_info()];
            let v: GroupedCiphertext2HandlesValidityProofContext = verify_and_extract_context::<
                GroupedCiphertext2HandlesValidityProofData,
                _,
            >(
                &mut one.iter(), 0, None
            )
            .map_err(|_| error!(CreditError::BadPartialProof))?;
            require!(
                bytes_of(&v.first_pubkey) == ctx.accounts.borrower_record.elgamal_pubkey,
                CreditError::MemberKeyMismatch
            );
            require!(
                bytes_of(&v.second_pubkey) == ctx.accounts.auction_config.auditor_elgamal_pubkey,
                CreditError::AuditorKeyMismatch
            );
            require!(bytes_of(&v.grouped_ciphertext) == size_ct, CreditError::BadPartialProof);
            zk::close_context(&ctx_acc.to_account_info(), &ctx.accounts.admin.to_account_info())?;
            size_ct
        }
    };

    let loan = &mut ctx.accounts.loan;
    loan.lender = l.member;
    loan.borrower = b.member;
    loan.epoch = epoch;
    loan.tick = r_star;
    loan.bid_tick = b.tick;
    loan.k = k;
    loan.status = LoanStatus::Pending as u8;
    loan.collateral_released = false;
    // The lender's fill ratio: asks strictly below the marginal tick fill fully.
    (loan.fill_num, loan.fill_den) = if l.tick < marginal_tick { (1, 1) } else { ratio };
    loan.size_ct = size_ct;
    loan.bump = ctx.bumps.loan;
    emit!(MatchPosted {
        loan: loan.key(),
        epoch,
        tick: r_star,
        borrower: b.member,
        lender: l.member
    });
    Ok(())
}
