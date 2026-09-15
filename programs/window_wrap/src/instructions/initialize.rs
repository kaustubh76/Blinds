use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use spl_token_2022_interface::extension::{
    confidential_transfer::ConfidentialTransferMint, scaled_ui_amount::ScaledUiAmountConfig,
    BaseStateWithExtensions, StateWithExtensions,
};

use crate::{errors::WrapError, seeds, state::Vault};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: the registry program id, recorded for member checks.
    pub registry_program: UncheckedAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mock_mint: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = token_program)]
    pub cstock_mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = admin, space = 8 + Vault::INIT_SPACE, seeds = [seeds::VAULT, mock_mint.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    /// CHECK: PDA that is the mint authority of cSTOCK-W.
    #[account(seeds = [seeds::MINT_AUTHORITY], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        associated_token::mint = mock_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub custody: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<Initialize>) -> Result<()> {
    // cSTOCK-W: this program's PDA must be the mint authority, and the confidential-transfer
    // extension must be present (with an auditor) so deposits land in a confidential balance.
    require!(
        ctx.accounts.cstock_mint.mint_authority.contains(&ctx.accounts.mint_authority.key()),
        WrapError::BadMintConfig
    );
    require!(
        ctx.accounts.cstock_mint.decimals == ctx.accounts.mock_mint.decimals,
        WrapError::BadMintConfig
    );
    {
        let info = ctx.accounts.cstock_mint.to_account_info();
        let data = info.try_borrow_data()?;
        let state = StateWithExtensions::<spl_token_2022_interface::state::Mint>::unpack(&data)?;
        let ct = state
            .get_extension::<ConfidentialTransferMint>()
            .map_err(|_| error!(WrapError::BadMintConfig))?;
        let auditor: Option<
            spl_token_2022_interface::solana_zk_sdk::encryption::pod::elgamal::PodElGamalPubkey,
        > = ct.auditor_elgamal_pubkey.into();
        require!(auditor.is_some(), WrapError::BadMintConfig);
    }
    // mock-xStock: must carry the rebasing multiplier extension the credit program reads.
    {
        let info = ctx.accounts.mock_mint.to_account_info();
        let data = info.try_borrow_data()?;
        let state = StateWithExtensions::<spl_token_2022_interface::state::Mint>::unpack(&data)?;
        state
            .get_extension::<ScaledUiAmountConfig>()
            .map_err(|_| error!(WrapError::BadMintConfig))?;
    }
    let v = &mut ctx.accounts.vault;
    v.admin = ctx.accounts.admin.key();
    v.registry_program = ctx.accounts.registry_program.key();
    v.mock_mint = ctx.accounts.mock_mint.key();
    v.cstock_mint = ctx.accounts.cstock_mint.key();
    v.custody = ctx.accounts.custody.key();
    v.wrapped = 0;
    v.decimals = ctx.accounts.mock_mint.decimals;
    v.bump = ctx.bumps.vault;
    v.mint_authority_bump = ctx.bumps.mint_authority;
    Ok(())
}
