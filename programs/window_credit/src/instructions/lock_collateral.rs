//! The priced solvency check (spec v2 §7.3). Four proof contexts, all context-state accounts
//! with the borrower as authority: collateral validity, collateral 32-bit range, equality of
//! `E_Δ` with a commitment `K`, and a 64-bit range proof on `K`.

use anchor_lang::prelude::*;
use bytemuck::bytes_of;
use solana_zk_elgamal_proof_interface::proof_data::{
    BatchedRangeProofContext, BatchedRangeProofU64Data, CiphertextCommitmentEqualityProofContext,
    CiphertextCommitmentEqualityProofData, GroupedCiphertext2HandlesValidityProofContext,
    GroupedCiphertext2HandlesValidityProofData,
};
use spl_token_2022_interface::extension::{
    scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, StateWithExtensions,
};
use spl_token_confidential_transfer_proof_extraction::instruction::verify_and_extract_context;
use window_auction::state::Config as AuctionConfig;
use window_elgamal::{solvency_delta, GroupedCiphertext2};
use window_proofs::scalar::{self, COLLATERAL_BITS};
use window_registry::state::Member;

use crate::{
    errors::CreditError,
    events::LockRequested,
    quote, seeds,
    state::{Config, Listing, Loan, LoanStatus},
    zk,
};

/// The borrower's priced solvency proof against `listing`; `price_account` is whichever account `quote::read_quote` accepts for its source.
#[derive(Accounts)]
pub struct LockCollateral<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [window_auction::seeds::CONFIG], bump = auction_config.bump, seeds::program = config.auction_program)]
    pub auction_config: Box<Account<'info, AuctionConfig>>,
    #[account(
        seeds = [window_registry::seeds::MEMBER, borrower.key().as_ref()],
        bump = borrower_record.bump,
        seeds::program = config.registry_program,
    )]
    pub borrower_record: Box<Account<'info, Member>>,
    #[account(mut, has_one = borrower @ CreditError::Unauthorized)]
    pub loan: Box<Account<'info, Loan>>,
    /// The collateral the borrower locks under; bound to the loan here.
    #[account(seeds = [seeds::LISTING, listing.cstock_mint.as_ref()], bump = listing.bump)]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: the listing's `PriceCache` PDA, or for a `PRICE_SOURCE_PYTH_ACCOUNT` listing a Pyth
    /// receiver-owned `PriceUpdateV2`; owner, address / feed id and verification are checked by `quote::read_quote`.
    pub price_cache: UncheckedAccount<'info>,
    /// CHECK: the listing's mock mint; its `ScaledUiAmount` extension is read.
    #[account(address = listing.mock_mint)]
    pub mock_mint: UncheckedAccount<'info>,
    /// CHECK: proof contexts, checked in the handler.
    #[account(mut)]
    pub validity_ctx: UncheckedAccount<'info>,
    /// CHECK: proof contexts, checked in the handler.
    #[account(mut)]
    pub range32_ctx: UncheckedAccount<'info>,
    /// CHECK: proof contexts, checked in the handler.
    #[account(mut)]
    pub equality_ctx: UncheckedAccount<'info>,
    /// CHECK: proof contexts, checked in the handler.
    #[account(mut)]
    pub range64_ctx: UncheckedAccount<'info>,
    /// CHECK: ZK ElGamal Proof program, for the close CPIs.
    #[account(address = zk::zk_program_id())]
    pub zk_program: UncheckedAccount<'info>,
}

fn multiplier_from_mint(mint: &AccountInfo, now: i64) -> Result<f64> {
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<spl_token_2022_interface::state::Mint>::unpack(&data)?;
    let cfg = state
        .get_extension::<ScaledUiAmountConfig>()
        .map_err(|_| error!(CreditError::MultiplierInvalid))?;
    let effective: i64 = cfg.new_multiplier_effective_timestamp.into();
    Ok(if now >= effective { cfg.new_multiplier.into() } else { cfg.multiplier.into() })
}

pub(crate) fn handler(ctx: Context<LockCollateral>) -> Result<()> {
    let loan = &mut ctx.accounts.loan;
    require!(loan.status() == Some(LoanStatus::Pending), CreditError::NotPending);
    let clock = Clock::get()?;
    let config = &ctx.accounts.config;
    let listing = &ctx.accounts.listing;

    // Freshness: the quote was posted recently, and the quote itself is recent.
    let price = quote::read_quote(listing, &ctx.accounts.price_cache.to_account_info())?;
    let price = &price;
    require!(
        clock.slot.saturating_sub(price.posted_slot) <= listing.max_price_age,
        CreditError::PriceStale
    );
    require!(
        clock.unix_timestamp.saturating_sub(price.publish_time) <= listing.max_publish_age_secs,
        CreditError::QuoteStale
    );

    // Public scalars: price in cents, multiplier in thousandths, haircut → (k_c, k_l).
    let price_cents = scalar::price_scaled(price.price, price.expo).ok_or(CreditError::BadPrice)?;
    let mult_scaled = if config.multiplier_override > 0 {
        config.multiplier_override
    } else {
        scalar::multiplier_scaled(multiplier_from_mint(
            &ctx.accounts.mock_mint.to_account_info(),
            clock.unix_timestamp,
        )?)
        .ok_or(CreditError::MultiplierInvalid)?
    };
    let scalars = scalar::solvency_scalars(price_cents, mult_scaled, listing.haircut_bps)
        .ok_or(CreditError::BadParams)?;
    require!(scalar::scalar_bound_ok(&scalars), CreditError::ScalarBound);

    // Contexts: owner, authority, type.
    let borrower = ctx.accounts.borrower.key();
    for c in [
        &ctx.accounts.validity_ctx,
        &ctx.accounts.range32_ctx,
        &ctx.accounts.equality_ctx,
        &ctx.accounts.range64_ctx,
    ] {
        zk::require_context_authority(&c.to_account_info(), &borrower)?;
    }
    let extract_validity =
        |acc: &UncheckedAccount| -> Result<GroupedCiphertext2HandlesValidityProofContext> {
            let one = [acc.to_account_info()];
            verify_and_extract_context::<GroupedCiphertext2HandlesValidityProofData, _>(
                &mut one.iter(),
                0,
                None,
            )
            .map_err(|_| error!(CreditError::WrongProofType))
        };
    let extract_range = |acc: &UncheckedAccount| -> Result<BatchedRangeProofContext> {
        let one = [acc.to_account_info()];
        verify_and_extract_context::<BatchedRangeProofU64Data, _>(&mut one.iter(), 0, None)
            .map_err(|_| error!(CreditError::WrongProofType))
    };
    let validity = extract_validity(&ctx.accounts.validity_ctx)?;
    let range32 = extract_range(&ctx.accounts.range32_ctx)?;
    let equality: CiphertextCommitmentEqualityProofContext = {
        let one = [ctx.accounts.equality_ctx.to_account_info()];
        verify_and_extract_context::<CiphertextCommitmentEqualityProofData, _>(
            &mut one.iter(),
            0,
            None,
        )
        .map_err(|_| error!(CreditError::WrongProofType))?
    };
    let range64 = extract_range(&ctx.accounts.range64_ctx)?;

    // Collateral claim: well-formed under (borrower, auditor), shares < 2^32.
    let borrower_key = ctx.accounts.borrower_record.elgamal_pubkey;
    require!(bytes_of(&validity.first_pubkey) == borrower_key, CreditError::MemberKeyMismatch);
    require!(
        bytes_of(&validity.second_pubkey) == ctx.accounts.auction_config.auditor_elgamal_pubkey,
        CreditError::AuditorKeyMismatch
    );
    let collateral = GroupedCiphertext2::from_bytes(
        bytes_of(&validity.grouped_ciphertext)
            .try_into()
            .map_err(|_| error!(CreditError::WrongProofType))?,
    );
    require!(
        bytes_of(&range32.commitments[0]) == collateral.commitment.0,
        CreditError::CollateralRangeMismatch
    );
    require!(
        range32.bit_lengths[0] as u32 == COLLATERAL_BITS,
        CreditError::CollateralRangeMismatch
    );

    // E_Δ = k_c·E_c − k_l·E_ℓ under the borrower's handles, via curve syscalls.
    let e_c = collateral.to_ciphertext(0).ok_or(CreditError::CurveError)?;
    let loan_ct = GroupedCiphertext2::from_bytes(&loan.size_ct);
    let e_l = loan_ct.to_ciphertext(0).ok_or(CreditError::CurveError)?;
    let e_delta = solvency_delta(&e_c, scalars.k_c, &e_l, scalars.k_l)
        .map_err(|_| error!(CreditError::CurveError))?;
    require!(bytes_of(&equality.pubkey) == borrower_key, CreditError::MemberKeyMismatch);
    require!(bytes_of(&equality.ciphertext) == e_delta.to_bytes(), CreditError::DeltaMismatch);
    require!(
        bytes_of(&range64.commitments[0]) == bytes_of(&equality.commitment),
        CreditError::DeltaRangeMismatch
    );
    require!(range64.bit_lengths[0] == 64, CreditError::DeltaRangeMismatch);

    // Record the public scalars and the ciphertexts; consume the contexts.
    loan.collateral_ct = collateral.to_bytes();
    loan.delta_commitment.copy_from_slice(bytes_of(&equality.commitment));
    loan.k_c = scalars.k_c;
    loan.k_l = scalars.k_l;
    loan.price_at_lock = price_cents;
    loan.mult_at_lock = mult_scaled;
    loan.lock_slot = clock.slot;
    loan.listing = listing.key();
    loan.status = LoanStatus::Requested as u8;
    let loan_key = loan.key();
    let borrower_info = ctx.accounts.borrower.to_account_info();
    for c in [
        &ctx.accounts.validity_ctx,
        &ctx.accounts.range32_ctx,
        &ctx.accounts.equality_ctx,
        &ctx.accounts.range64_ctx,
    ] {
        zk::close_context(&c.to_account_info(), &borrower_info)?;
    }
    emit!(LockRequested {
        loan: loan_key,
        price_at_lock: price_cents,
        mult_at_lock: mult_scaled,
        listing: listing.key()
    });
    Ok(())
}
