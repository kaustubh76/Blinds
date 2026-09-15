//! The only way a size enters the market: as a proven ciphertext.
//!
//! Transaction shape (built by the SDK): `[VerifyGroupedCiphertext2HandlesValidity, submit_bid]`,
//! with the range proof already verified into `range_ctx` by an earlier transaction.

use anchor_lang::prelude::*;
use bytemuck::bytes_of;
use solana_zk_sdk::zk_elgamal_proof_program::proof_data::{
    BatchedRangeProofContext, BatchedRangeProofU64Data,
    GroupedCiphertext2HandlesValidityProofContext, GroupedCiphertext2HandlesValidityProofData,
};
use spl_token_confidential_transfer_proof_extraction::instruction::verify_and_extract_context;
use window_clearing::{Side, Tick, BID_BITS};
use window_elgamal::{shifted_commitment, Ciphertext, GroupedCiphertext2, Point};
use window_registry::state::Member;

use crate::{
    errors::AuctionError,
    events::BidSubmitted,
    seeds,
    state::{Bid, Config, Epoch, EpochStatus},
    zk,
};

#[derive(Accounts)]
#[instruction(side: u8, tick: u8)]
pub struct SubmitBid<'info> {
    #[account(mut)]
    pub member: Signer<'info>,
    /// The member's registry record (owned by `window_registry`; Anchor checks the owner).
    #[account(
        seeds = [window_registry::seeds::MEMBER, member.key().as_ref()],
        bump = member_record.bump,
        seeds::program = config.registry_program,
        constraint = member_record.owner == member.key() @ AuctionError::Unauthorized,
    )]
    pub member_record: Account<'info, Member>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [seeds::EPOCH, &config.current_epoch.to_le_bytes()], bump = epoch.load()?.bump)]
    pub epoch: AccountLoader<'info, Epoch>,
    #[account(
        init,
        payer = member,
        space = 8 + Bid::INIT_SPACE,
        seeds = [seeds::BID, &config.current_epoch.to_le_bytes(), member.key().as_ref(), &[side], &[tick]],
        bump
    )]
    pub bid: Account<'info, Bid>,
    /// CHECK: context-state account holding the verified range proof; owner/type/authority checked in the handler.
    #[account(mut)]
    pub range_ctx: UncheckedAccount<'info>,
    /// CHECK: the Instructions sysvar, address-checked.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    /// CHECK: the ZK ElGamal Proof program, address-checked; needed for the close CPI.
    #[account(address = zk::zk_program_id())]
    pub zk_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler<'info>(
    ctx: Context<'info, SubmitBid<'info>>,
    side: u8,
    tick: u8,
) -> Result<()> {
    let side_e = Side::from_u8(side).ok_or(AuctionError::BadSide)?;
    let tick_e = Tick::new(tick).ok_or(AuctionError::BadTick)?;
    require!(ctx.accounts.member_record.active, AuctionError::MemberInactive);
    let config = &ctx.accounts.config;
    let member_key = ctx.accounts.member.key();

    // --- validity proof: the previous instruction in this transaction ---
    let ix_info = ctx.accounts.instructions.to_account_info();
    let validity: GroupedCiphertext2HandlesValidityProofContext = {
        let empty: &[AccountInfo<'info>] = &[];
        verify_and_extract_context::<GroupedCiphertext2HandlesValidityProofData, _>(
            &mut empty.iter(),
            -1,
            Some(&ix_info),
        )
        .map_err(|_| error!(AuctionError::WrongProofType))?
    };
    require!(
        bytes_of(&validity.first_pubkey) == ctx.accounts.member_record.elgamal_pubkey,
        AuctionError::MemberKeyMismatch
    );

    // --- range proof: context-state account, authority = member ---
    let range_acc = ctx.accounts.range_ctx.to_account_info();
    zk::require_context_authority(&range_acc, &member_key)?;
    let range: BatchedRangeProofContext = {
        let one = [range_acc.clone()];
        verify_and_extract_context::<BatchedRangeProofU64Data, _>(&mut one.iter(), 0, None)
            .map_err(|_| error!(AuctionError::WrongProofType))?
    };

    let grouped = GroupedCiphertext2::from_bytes(
        bytes_of(&validity.grouped_ciphertext)
            .try_into()
            .map_err(|_| error!(AuctionError::WrongProofType))?,
    );

    let mut epoch = ctx.accounts.epoch.load_mut()?;
    require!(epoch.status() == Some(EpochStatus::Open), AuctionError::NotOpen);
    require!(
        bytes_of(&validity.second_pubkey) == epoch.auditor_pubkey,
        AuctionError::AuditorKeyMismatch
    );
    require!(epoch.total_bids < config.max_bids_per_epoch, AuctionError::TooManyBids);

    // range.commitments[0] must be C − s_min·G with a 40-bit range.
    let shifted = shifted_commitment(&grouped.commitment, config.s_min)
        .map_err(|_| error!(AuctionError::CurveError))?;
    require!(bytes_of(&range.commitments[0]) == shifted.0, AuctionError::RangeCommitmentMismatch);
    require!(range.bit_lengths[0] as u32 == BID_BITS, AuctionError::RangeBitLength);

    // --- accumulate (commitment, auditor handle) via curve syscalls ---
    let (s, t) = (side_e.index(), tick_e.index());
    let acc = Ciphertext {
        commitment: Point(epoch.acc_commitment[s][t]),
        handle: Point(epoch.acc_handle[s][t]),
    };
    let acc = acc.accumulate(&grouped, 1).map_err(|_| error!(AuctionError::CurveError))?;
    epoch.acc_commitment[s][t] = acc.commitment.0;
    epoch.acc_handle[s][t] = acc.handle.0;
    epoch.bid_count[s][t] =
        epoch.bid_count[s][t].checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    epoch.total_bids = epoch.total_bids.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    let epoch_index = epoch.index;
    drop(epoch);

    // --- record the bid ---
    let bid = &mut ctx.accounts.bid;
    bid.epoch = epoch_index;
    bid.member = member_key;
    bid.side = side;
    bid.tick = tick;
    bid.ciphertext = grouped.to_bytes();
    bid.slot = Clock::get()?.slot;
    bid.bump = ctx.bumps.bid;

    // --- consume the range context (rent back to the member) ---
    zk::close_context(&range_acc, &ctx.accounts.member.to_account_info())?;

    emit!(BidSubmitted { epoch: epoch_index, member: member_key, side, tick });
    Ok(())
}
