//! The collateral schedule: `add_listing` registers an eligible collateral, `update_listing` retunes
//! its limits. Both admin-only. Mints are unpacked by hand rather than typed as `InterfaceAccount<Mint>`
//! to keep the program under its size budget — the same unpack path `lock_collateral` uses.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;
use spl_token_2022_interface::extension::{
    scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, StateWithExtensions,
};

use crate::{
    errors::CreditError,
    events::ListingAdded,
    seeds,
    state::{Config, Listing, ListingParams, PRICE_SOURCE_MAX},
};

#[derive(Accounts)]
pub struct AddListing<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ CreditError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: Token-2022 mint; owner, decimals and the `ScaledUiAmount` extension are checked in the handler.
    pub mock_mint: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint; owner and decimals are checked in the handler.
    pub cstock_mint: UncheckedAccount<'info>,
    /// The operator's confidential account for this listing's escrow.
    #[account(token::mint = cstock_mint, token::authority = config.operator)]
    pub escrow_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Listing::INIT_SPACE,
        seeds = [seeds::LISTING, cstock_mint.key().as_ref()],
        bump
    )]
    pub listing: Box<Account<'info, Listing>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateListing<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = admin @ CreditError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [seeds::LISTING, listing.cstock_mint.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
}

fn validate(p: &ListingParams) -> Result<()> {
    require!(p.haircut_bps >= 10_000 && p.haircut_bps.is_multiple_of(100), CreditError::BadParams);
    require!(p.max_price_age > 0 && p.max_publish_age_secs > 0, CreditError::BadParams);
    require!(p.price_source <= PRICE_SOURCE_MAX, CreditError::BadParams);
    Ok(())
}

/// Decimals of a Token-2022 mint, and whether it carries `ScaledUiAmount`.
fn inspect_mint(mint: &AccountInfo) -> Result<(u8, bool)> {
    require_keys_eq!(*mint.owner, spl_token_2022_interface::id(), CreditError::BadParams);
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<spl_token_2022_interface::state::Mint>::unpack(&data)
        .map_err(|_| error!(CreditError::BadParams))?;
    let scaled = state.get_extension::<ScaledUiAmountConfig>().is_ok();
    Ok((state.base.decimals, scaled))
}

pub(crate) fn add(ctx: Context<AddListing>, p: ListingParams) -> Result<()> {
    validate(&p)?;
    let (mock_decimals, scaled) = inspect_mint(&ctx.accounts.mock_mint.to_account_info())?;
    let (cstock_decimals, _) = inspect_mint(&ctx.accounts.cstock_mint.to_account_info())?;
    require!(scaled, CreditError::MultiplierInvalid);
    require!(mock_decimals == cstock_decimals, CreditError::BadParams);
    let listing = &mut ctx.accounts.listing;
    listing.mock_mint = ctx.accounts.mock_mint.key();
    listing.cstock_mint = ctx.accounts.cstock_mint.key();
    listing.escrow_account = ctx.accounts.escrow_account.key();
    listing.feed_id = p.feed_id;
    listing.price_source = p.price_source;
    listing.haircut_bps = p.haircut_bps;
    listing.max_price_age = p.max_price_age;
    listing.max_publish_age_secs = p.max_publish_age_secs;
    listing.symbol = p.symbol;
    listing.decimals = mock_decimals;
    listing.bump = ctx.bumps.listing;
    emit!(ListingAdded {
        listing: listing.key(),
        cstock_mint: listing.cstock_mint,
        feed_id: listing.feed_id
    });
    Ok(())
}

pub(crate) fn update(ctx: Context<UpdateListing>, p: ListingParams) -> Result<()> {
    validate(&p)?;
    let listing = &mut ctx.accounts.listing;
    // Mints, escrow and feed id are fixed: open loans and the price cache PDA depend on them.
    listing.price_source = p.price_source;
    listing.haircut_bps = p.haircut_bps;
    listing.max_price_age = p.max_price_age;
    listing.max_publish_age_secs = p.max_publish_age_secs;
    listing.symbol = p.symbol;
    Ok(())
}
