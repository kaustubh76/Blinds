//! The collateral leg in the harness: mints, the wrap vault, the credit config with an escrow,
//! member onboarding, and the loan flow with real solvency proofs.

use anchor_lang::{InstructionData, ToAccountMetas};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_zk_elgamal_proof_interface::proof_data::{
    BatchedRangeProofContext, CiphertextCommitmentEqualityProofContext,
    GroupedCiphertext2HandlesValidityProofContext,
};
use window_elgamal::{encrypt::Opening, GroupedCiphertext2};
use window_proofs::{
    ix,
    scalar::{self, SolvencyScalars},
    solvency::{self, CollateralClaim, SolvencyInputs, SolvencyProofs},
};

use crate::{
    pda,
    tokens::{token_2022, ConfidentialAccount},
    Harness, TxError, TxStats,
};

/// One listing of the collateral schedule plus the shared credit config, created by
/// [`Harness::with_credit`] (listing #0) and [`Harness::add_listing`] (further listings).
pub struct CreditSetup {
    pub mock_mint: Pubkey,
    pub cstock_mint: Pubkey,
    pub decimals: u8,
    pub vault: Pubkey,
    pub custody: Pubkey,
    pub credit_config: Pubkey,
    pub listing: Pubkey,
    pub price_cache: Pubkey,
    pub operator: Keypair,
    pub escrow: ConfidentialAccount,
    pub feed_id: [u8; 32],
    pub haircut_bps: u64,
    pub max_publish_age_secs: i64,
}

impl CreditSetup {
    pub fn listing_params(&self) -> window_credit::state::ListingParams {
        window_credit::state::ListingParams {
            feed_id: self.feed_id,
            price_source: window_credit::state::PRICE_SOURCE_MOCK,
            haircut_bps: self.haircut_bps,
            max_price_age: 0, // filled by the caller
            max_publish_age_secs: self.max_publish_age_secs,
            symbol: *b"MOCK\0\0\0\0\0\0\0\0\0\0\0\0",
        }
    }
}

fn escrow_key(setup: &CreditSetup) -> Pubkey {
    setup.escrow.address
}

/// A member's token-side state.
pub struct MemberTokens {
    pub mock: Pubkey,
    pub cstock: ConfidentialAccount,
}

impl Harness {
    pub fn wrap_program() -> Pubkey {
        window_wrap::ID
    }
    pub fn credit_program() -> Pubkey {
        window_credit::ID
    }

    /// A mock mint, its confidential twin and the wrap vault — the token side of one listing.
    fn create_listing_mints(&mut self, decimals: u8) -> (Pubkey, Pubkey, Pubkey, Pubkey) {
        let mock_mint = self.create_mock_xstock_mint(decimals, 1.0);
        let mint_authority = pda::wrap_mint_authority();
        let cstock_mint = self.create_confidential_mint(&mint_authority, decimals);
        let vault = pda::wrap_vault(&mock_mint);
        let custody = pda::ata(&vault, &mock_mint);
        let admin = self.admin.insecure_clone();
        let ix_init = Instruction {
            program_id: window_wrap::ID,
            accounts: window_wrap::accounts::Initialize {
                admin: admin.pubkey(),
                registry_program: self.registry,
                mock_mint,
                cstock_mint,
                vault,
                mint_authority,
                custody,
                token_program: token_2022(),
                associated_token_program: pda::ASSOCIATED_TOKEN_PROGRAM,
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_wrap::instruction::Initialize {}.data(),
        };
        self.send(&admin, &[ix_init], &[]).expect("wrap initialize");
        (mock_mint, cstock_mint, vault, custody)
    }

    fn add_listing_ix(
        &self,
        mock_mint: &Pubkey,
        cstock_mint: &Pubkey,
        escrow: &Pubkey,
        params: window_credit::state::ListingParams,
    ) -> Instruction {
        Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::AddListing {
                admin: self.admin.pubkey(),
                config: pda::credit_config(),
                mock_mint: *mock_mint,
                cstock_mint: *cstock_mint,
                escrow_account: *escrow,
                listing: pda::listing(cstock_mint),
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_credit::instruction::AddListing { params }.data(),
        }
    }

    /// Loads wrap + credit, creates the mints, initialises the vault and the credit config
    /// (operator = a fresh key with a confidential escrow account), and lists that collateral
    /// as listing #0 — the same shape as the devnet deployment after the listing upgrade.
    pub fn with_credit(&mut self) -> CreditSetup {
        for (id, name) in [(window_wrap::ID, "window_wrap"), (window_credit::ID, "window_credit")] {
            let path = crate::deploy_dir().join(format!("{name}.so"));
            let bytes = std::fs::read(&path)
                .unwrap_or_else(|e| panic!("{}: {e} — run `anchor build`", path.display()));
            self.svm.add_program(crate::addr(&id), &bytes).expect("add_program");
        }
        let decimals = 3u8; // milli-shares
        let (mock_mint, cstock_mint, vault, custody) = self.create_listing_mints(decimals);
        let admin = self.admin.insecure_clone();

        let operator = Keypair::new();
        self.svm.airdrop(&crate::addr(&operator.pubkey()), 100_000_000_000).unwrap();
        let escrow = self.create_confidential_account(&cstock_mint, &operator);
        let feed_id = [7u8; 32];
        let credit_config = pda::credit_config();
        let ix_init = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::Initialize {
                admin: admin.pubkey(),
                config: credit_config,
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_credit::instruction::Initialize {
                params: window_credit::state::InitializeParams {
                    operator: operator.pubkey(),
                    keeper: admin.pubkey(),
                    oracle_program: self.oracle,
                    auction_program: self.auction,
                    registry_program: self.registry,
                    cstock_mint,
                    mock_mint,
                    escrow_account: escrow.address,
                    feed_id,
                    haircut_bps: self.profile.credit.haircut_bps,
                    max_price_age: self.profile.market.max_price_age_slots,
                    tenor_slots: self.profile.market.tenor_slots,
                    multiplier_override: 0,
                },
            }
            .data(),
        };
        self.send(&admin, &[ix_init], &[]).expect("credit initialize");
        let setup = CreditSetup {
            mock_mint,
            cstock_mint,
            decimals,
            vault,
            custody,
            credit_config,
            listing: pda::listing(&cstock_mint),
            price_cache: pda::price_cache(&feed_id),
            operator,
            escrow,
            feed_id,
            haircut_bps: self.profile.credit.haircut_bps,
            max_publish_age_secs: self.profile.primary().max_publish_age_secs,
        };
        let mut params = setup.listing_params();
        params.max_price_age = self.profile.market.max_price_age_slots;
        params.symbol = self.profile.primary().symbol_bytes();
        let ix = self.add_listing_ix(&mock_mint, &cstock_mint, &escrow_key(&setup), params);
        self.send(&admin, &[ix], &[]).expect("add_listing #0");
        setup
    }

    /// Lists a second collateral: fresh mints and vault, an escrow under the same operator, its
    /// own feed id, haircut and quote-age limit. Shares `credit_config` with `base`.
    pub fn add_listing(
        &mut self,
        base: &CreditSetup,
        feed_id: [u8; 32],
        haircut_bps: u64,
        max_publish_age_secs: i64,
    ) -> CreditSetup {
        let decimals = base.decimals;
        let (mock_mint, cstock_mint, vault, custody) = self.create_listing_mints(decimals);
        let operator = base.operator.insecure_clone();
        let escrow = self.create_confidential_account(&cstock_mint, &operator);
        let setup = CreditSetup {
            mock_mint,
            cstock_mint,
            decimals,
            vault,
            custody,
            credit_config: base.credit_config,
            listing: pda::listing(&cstock_mint),
            price_cache: pda::price_cache(&feed_id),
            operator,
            escrow,
            feed_id,
            haircut_bps,
            max_publish_age_secs,
        };
        let mut params = setup.listing_params();
        params.max_price_age = self.profile.market.max_price_age_slots;
        params.symbol = *b"SECOND-mock\0\0\0\0\0";
        let ix = self.add_listing_ix(&mock_mint, &cstock_mint, &setup.escrow.address, params);
        let admin = self.admin.insecure_clone();
        self.send(&admin, &[ix], &[]).expect("add_listing");
        setup
    }

    /// `add_listing` as `signer` with arbitrary params — for the admin-gate attack cases.
    pub fn try_add_listing(
        &mut self,
        signer: &Keypair,
        mock_mint: &Pubkey,
        cstock_mint: &Pubkey,
        escrow: &Pubkey,
        params: window_credit::state::ListingParams,
    ) -> Result<TxStats, TxError> {
        let mut ix = self.add_listing_ix(mock_mint, cstock_mint, escrow, params);
        ix.accounts[0].pubkey = signer.pubkey();
        self.send(signer, &[ix], &[])
    }

    pub fn update_listing(
        &mut self,
        signer: &Keypair,
        setup: &CreditSetup,
        params: window_credit::state::ListingParams,
    ) -> Result<TxStats, TxError> {
        let ix = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::UpdateListing {
                admin: signer.pubkey(),
                config: setup.credit_config,
                listing: setup.listing,
            }
            .to_account_metas(None),
            data: window_credit::instruction::UpdateListing { params }.data(),
        };
        self.send(signer, &[ix], &[])
    }

    pub fn migrate_loan(
        &mut self,
        signer: &Keypair,
        setup: &CreditSetup,
        loan: &Pubkey,
    ) -> Result<TxStats, TxError> {
        let ix = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::MigrateLoan {
                admin: signer.pubkey(),
                config: setup.credit_config,
                listing: setup.listing,
                loan: *loan,
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_credit::instruction::MigrateLoan {}.data(),
        };
        self.send(signer, &[ix], &[])
    }

    pub fn listing(&self, key: &Pubkey) -> window_credit::state::Listing {
        self.account(key)
    }

    /// Gives member `m` `mock_amount` mock-xStock and a configured cSTOCK-W confidential account.
    pub fn onboard_tokens(
        &mut self,
        setup: &CreditSetup,
        m: usize,
        mock_amount: u64,
    ) -> MemberTokens {
        let wallet = self.members[m].wallet.insecure_clone();
        let mock = self.create_token_account(&setup.mock_mint, &wallet);
        self.mint_to(&setup.mock_mint, &mock, mock_amount);
        let cstock = self.create_confidential_account(&setup.cstock_mint, &wallet);
        MemberTokens { mock, cstock }
    }

    /// `wrap(amount)` then `ApplyPendingBalance`; the member's confidential balance grows by `amount`.
    pub fn wrap(
        &mut self,
        setup: &CreditSetup,
        m: usize,
        tokens: &mut MemberTokens,
        amount: u64,
    ) -> Result<TxStats, TxError> {
        let wallet = self.members[m].wallet.insecure_clone();
        let ix = Instruction {
            program_id: window_wrap::ID,
            accounts: window_wrap::accounts::Wrap {
                member: wallet.pubkey(),
                member_record: pda::member(&wallet.pubkey()),
                vault: setup.vault,
                mock_mint: setup.mock_mint,
                cstock_mint: setup.cstock_mint,
                member_mock: tokens.mock,
                custody: setup.custody,
                member_cstock: tokens.cstock.address,
                mint_authority: pda::wrap_mint_authority(),
                token_program: token_2022(),
            }
            .to_account_metas(None),
            data: window_wrap::instruction::Wrap { amount }.data(),
        };
        let stats = self.send(&wallet, &[ix], &[])?;
        self.apply_pending_balance(&mut tokens.cstock, &wallet, amount)?;
        Ok(stats)
    }

    pub fn unwrap(
        &mut self,
        setup: &CreditSetup,
        m: usize,
        tokens: &MemberTokens,
        amount: u64,
    ) -> Result<TxStats, TxError> {
        let wallet = self.members[m].wallet.insecure_clone();
        let ix = Instruction {
            program_id: window_wrap::ID,
            accounts: window_wrap::accounts::Unwrap {
                member: wallet.pubkey(),
                vault: setup.vault,
                mock_mint: setup.mock_mint,
                cstock_mint: setup.cstock_mint,
                member_mock: tokens.mock,
                custody: setup.custody,
                member_cstock: tokens.cstock.address,
                token_program: token_2022(),
            }
            .to_account_metas(None),
            data: window_wrap::instruction::Unwrap { amount }.data(),
        };
        self.send(&wallet, &[ix], &[])
    }

    /// Keeper posts a price: `price` with `expo` (Pyth style), e.g. `40_012_000_000, -8` = $400.12,
    /// published "now" (the harness clock's unix time).
    pub fn post_price(
        &mut self,
        setup: &CreditSetup,
        price: u64,
        expo: i32,
    ) -> Result<TxStats, TxError> {
        let now = self.unix_timestamp();
        self.post_price_at(setup, price, expo, now)
    }

    /// Keeper posts a price with an explicit `publish_time`.
    pub fn post_price_at(
        &mut self,
        setup: &CreditSetup,
        price: u64,
        expo: i32,
        publish_time: i64,
    ) -> Result<TxStats, TxError> {
        let admin = self.admin.insecure_clone();
        let ix = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::PostPrice {
                keeper: admin.pubkey(),
                config: setup.credit_config,
                listing: setup.listing,
                price_cache: setup.price_cache,
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_credit::instruction::PostPrice { price, expo, publish_time }.data(),
        };
        self.send(&admin, &[ix], &[])
    }

    /// Administrator posts a full-fill match; returns the loan address.
    pub fn post_match_full(
        &mut self,
        setup: &CreditSetup,
        epoch: u64,
        borrower: usize,
        bid_tick: u8,
        lender: usize,
        ask_tick: u8,
        k: u8,
    ) -> Result<Pubkey, TxError> {
        let admin = self.admin.insecure_clone();
        let b = self.members[borrower].pubkey();
        let l = self.members[lender].pubkey();
        let loan = pda::loan(epoch, &b, bid_tick, k);
        let ix = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::PostMatch {
                admin: admin.pubkey(),
                config: setup.credit_config,
                print: pda::print(epoch),
                auction_config: pda::auction_config(),
                borrower_bid: pda::bid(epoch, &b, 1, bid_tick),
                lender_bid: pda::bid(epoch, &l, 0, ask_tick),
                borrower_record: pda::member(&b),
                loan,
                partial_validity_ctx: None,
                zk_program: window_credit::zk::zk_program_id(),
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_credit::instruction::PostMatch {
                epoch,
                k,
                kind: window_credit::state::MatchKind::Full,
            }
            .data(),
        };
        self.send(&admin, &[ix], &[])?;
        Ok(loan)
    }

    pub fn loan(&self, key: &Pubkey) -> window_credit::state::Loan {
        self.account(key)
    }

    /// Builds the four proofs of a lock for `shares_milli` collateral against the loan's bid
    /// (the borrower knows its bid size and opening). Returns the claim and the pair.
    pub fn build_lock_proofs(
        &self,
        borrower: usize,
        loan: &window_credit::state::Loan,
        shares_milli: u64,
        loan_size: u64,
        loan_opening: &Opening,
        scalars: &SolvencyScalars,
    ) -> Result<(CollateralClaim, SolvencyProofs), window_proofs::ProofError> {
        let kp = &self.members[borrower].elgamal;
        let claim = solvency::build_collateral(kp, &self.auditor.pubkey_bytes(), shares_milli)?;
        let ec = claim.ciphertext.to_ciphertext(0).unwrap();
        let el = GroupedCiphertext2::from_bytes(&loan.size_ct).to_ciphertext(0).unwrap();
        let inputs = SolvencyInputs {
            collateral: &ec,
            c: shares_milli,
            c_opening: &claim.opening,
            loan: &el,
            l: loan_size,
            l_opening: loan_opening,
        };
        let pair = solvency::build(kp, &inputs, scalars)?;
        Ok((claim, pair))
    }

    /// The scalars the program will derive from the current price cache and mint multiplier.
    pub fn current_scalars(&self, setup: &CreditSetup, multiplier: f64) -> SolvencyScalars {
        let cache: window_credit::state::PriceCache = self.account(&setup.price_cache);
        let p = scalar::price_scaled(cache.price, cache.expo).unwrap();
        let a = scalar::multiplier_scaled(multiplier).unwrap();
        scalar::solvency_scalars(p, a, setup.haircut_bps).unwrap()
    }

    /// Verifies the four proofs into context accounts (4 transactions) and calls `lock_collateral`.
    pub fn lock_collateral(
        &mut self,
        setup: &CreditSetup,
        borrower: usize,
        loan_key: &Pubkey,
        claim: &CollateralClaim,
        pair: &SolvencyProofs,
    ) -> Result<TxStats, TxError> {
        let wallet = self.members[borrower].wallet.insecure_clone();
        let owner = wallet.pubkey();
        let ctxs: Vec<Keypair> = (0..4).map(|_| Keypair::new()).collect();
        let rent_v = self.svm.minimum_balance_for_rent_exemption(ix::context_size::<
            GroupedCiphertext2HandlesValidityProofContext,
        >());
        let rent_r = self
            .svm
            .minimum_balance_for_rent_exemption(ix::context_size::<BatchedRangeProofContext>());
        let rent_e = self.svm.minimum_balance_for_rent_exemption(ix::context_size::<
            CiphertextCommitmentEqualityProofContext,
        >());
        let [c0, v0] =
            ix::create_and_verify(&owner, &ctxs[0].pubkey(), &owner, rent_v, &claim.validity);
        let [c1, v1] =
            ix::create_and_verify(&owner, &ctxs[1].pubkey(), &owner, rent_r, &claim.range);
        let [c2, v2] =
            ix::create_and_verify(&owner, &ctxs[2].pubkey(), &owner, rent_e, &pair.equality);
        let [c3, v3] =
            ix::create_and_verify(&owner, &ctxs[3].pubkey(), &owner, rent_r, &pair.range);
        self.send(&wallet, &[c0, v0, c2, v2], &[&ctxs[0], &ctxs[2]])?;
        self.send(&wallet, &[c1], &[&ctxs[1]])?;
        self.send(&wallet, &[v1], &[])?;
        self.send(&wallet, &[c3], &[&ctxs[3]])?;
        self.send(&wallet, &[v3], &[])?;
        let ix_lock = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::LockCollateral {
                borrower: owner,
                config: setup.credit_config,
                auction_config: pda::auction_config(),
                borrower_record: pda::member(&owner),
                loan: *loan_key,
                listing: setup.listing,
                price_cache: setup.price_cache,
                mock_mint: setup.mock_mint,
                validity_ctx: ctxs[0].pubkey(),
                range32_ctx: ctxs[1].pubkey(),
                equality_ctx: ctxs[2].pubkey(),
                range64_ctx: ctxs[3].pubkey(),
                zk_program: ix::zk_program_id(),
            }
            .to_account_metas(None),
            data: window_credit::instruction::LockCollateral {}.data(),
        };
        self.send(&wallet, &[ix_lock], &[])
    }

    /// `[confidential transfer borrower → escrow, deposit_collateral]` in one transaction.
    pub fn deposit_collateral(
        &mut self,
        setup: &CreditSetup,
        borrower: usize,
        tokens: &mut MemberTokens,
        loan_key: &Pubkey,
        shares_milli: u64,
    ) -> Result<TxStats, TxError> {
        let wallet = self.members[borrower].wallet.insecure_clone();
        let (transfer, close) = self.build_confidential_transfer(
            &mut tokens.cstock,
            &wallet,
            &setup.cstock_mint,
            &setup.escrow.address,
            shares_milli,
        )?;
        let ix_dep = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::DepositCollateral {
                borrower: wallet.pubkey(),
                config: setup.credit_config,
                loan: *loan_key,
                listing: setup.listing,
                borrower_cstock: tokens.cstock.address,
                instructions: crate::solana_instructions_sysvar_id(),
            }
            .to_account_metas(None),
            data: window_credit::instruction::DepositCollateral {}.data(),
        };
        let stats = self.send(&wallet, &[transfer, ix_dep], &[])?;
        self.close_contexts(&wallet, &close);
        Ok(stats)
    }

    fn simple_credit_ix(
        &self,
        setup: &CreditSetup,
        signer: &Pubkey,
        loan: &Pubkey,
        which: &str,
    ) -> Instruction {
        let (accounts, data) = match which {
            "confirm_lock" => (
                window_credit::accounts::ConfirmLock {
                    operator: *signer,
                    config: setup.credit_config,
                    loan: *loan,
                }
                .to_account_metas(None),
                window_credit::instruction::ConfirmLock {}.data(),
            ),
            "confirm_funding" => (
                window_credit::accounts::ConfirmFunding {
                    admin: *signer,
                    config: setup.credit_config,
                    loan: *loan,
                }
                .to_account_metas(None),
                window_credit::instruction::ConfirmFunding {}.data(),
            ),
            "repay" => (
                window_credit::accounts::Repay {
                    admin: *signer,
                    config: setup.credit_config,
                    loan: *loan,
                }
                .to_account_metas(None),
                window_credit::instruction::Repay {}.data(),
            ),
            "seize" => (
                window_credit::accounts::Seize {
                    anyone: *signer,
                    config: setup.credit_config,
                    loan: *loan,
                    listing: setup.listing,
                    price_cache: setup.price_cache,
                }
                .to_account_metas(None),
                window_credit::instruction::Seize {}.data(),
            ),
            _ => unreachable!(),
        };
        Instruction { program_id: window_credit::ID, accounts, data }
    }

    pub fn confirm_lock(&mut self, setup: &CreditSetup, loan: &Pubkey) -> Result<TxStats, TxError> {
        let op = setup.operator.insecure_clone();
        let ix = self.simple_credit_ix(setup, &op.pubkey(), loan, "confirm_lock");
        self.send(&op, &[ix], &[])
    }
    pub fn confirm_funding(
        &mut self,
        setup: &CreditSetup,
        loan: &Pubkey,
    ) -> Result<TxStats, TxError> {
        let admin = self.admin.insecure_clone();
        let ix = self.simple_credit_ix(setup, &admin.pubkey(), loan, "confirm_funding");
        self.send(&admin, &[ix], &[])
    }
    pub fn repay(&mut self, setup: &CreditSetup, loan: &Pubkey) -> Result<TxStats, TxError> {
        let admin = self.admin.insecure_clone();
        let ix = self.simple_credit_ix(setup, &admin.pubkey(), loan, "repay");
        self.send(&admin, &[ix], &[])
    }
    pub fn seize(
        &mut self,
        setup: &CreditSetup,
        loan: &Pubkey,
        caller: &Keypair,
    ) -> Result<TxStats, TxError> {
        let ix = self.simple_credit_ix(setup, &caller.pubkey(), loan, "seize");
        self.send(caller, &[ix], &[])
    }

    /// Operator moves escrowed collateral to `destination` and records the release.
    pub fn release_collateral(
        &mut self,
        setup: &mut CreditSetup,
        loan_key: &Pubkey,
        destination: &Pubkey,
        shares_milli: u64,
    ) -> Result<TxStats, TxError> {
        let op = setup.operator.insecure_clone();
        let (transfer, close) = self.build_confidential_transfer(
            &mut setup.escrow,
            &op,
            &setup.cstock_mint,
            destination,
            shares_milli,
        )?;
        let ix_rel = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::ReleaseCollateral {
                operator: op.pubkey(),
                config: setup.credit_config,
                loan: *loan_key,
                listing: setup.listing,
                destination: *destination,
                instructions: crate::solana_instructions_sysvar_id(),
            }
            .to_account_metas(None),
            data: window_credit::instruction::ReleaseCollateral {}.data(),
        };
        let stats = self.send(&op, &[transfer, ix_rel], &[])?;
        self.close_contexts(&op, &close);
        Ok(stats)
    }
}
