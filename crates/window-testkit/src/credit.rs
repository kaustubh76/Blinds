//! The collateral leg in the harness: mints, the wrap vault, the credit config with an escrow,
//! member onboarding, and the loan flow with real solvency proofs.

use anchor_lang::{InstructionData, ToAccountMetas};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_zk_sdk::zk_elgamal_proof_program::proof_data::{
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

/// Everything the collateral leg needs, created by [`Harness::with_credit`].
pub struct CreditSetup {
    pub mock_mint: Pubkey,
    pub cstock_mint: Pubkey,
    pub decimals: u8,
    pub vault: Pubkey,
    pub custody: Pubkey,
    pub credit_config: Pubkey,
    pub price_cache: Pubkey,
    pub operator: Keypair,
    pub escrow: ConfidentialAccount,
    pub feed_id: [u8; 32],
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

    /// Loads wrap + credit, creates the mints, initialises the vault and the credit config
    /// (operator = a fresh key with a confidential escrow account).
    pub fn with_credit(&mut self) -> CreditSetup {
        for (id, name) in [(window_wrap::ID, "window_wrap"), (window_credit::ID, "window_credit")] {
            let path = crate::deploy_dir().join(format!("{name}.so"));
            let bytes = std::fs::read(&path)
                .unwrap_or_else(|e| panic!("{}: {e} — run `anchor build`", path.display()));
            self.svm.add_program(id, &bytes).expect("add_program");
        }
        let decimals = 3u8; // milli-shares
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

        let operator = Keypair::new();
        self.svm.airdrop(&operator.pubkey(), 100_000_000_000).unwrap();
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
        CreditSetup {
            mock_mint,
            cstock_mint,
            decimals,
            vault,
            custody,
            credit_config,
            price_cache: pda::price_cache(&feed_id),
            operator,
            escrow,
            feed_id,
        }
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

    /// Keeper posts a price: `price` with `expo` (Pyth style), e.g. `40_012_000_000, -8` = $400.12.
    pub fn post_price(
        &mut self,
        setup: &CreditSetup,
        price: u64,
        expo: i32,
    ) -> Result<TxStats, TxError> {
        let admin = self.admin.insecure_clone();
        let ix = Instruction {
            program_id: window_credit::ID,
            accounts: window_credit::accounts::PostPrice {
                keeper: admin.pubkey(),
                config: setup.credit_config,
                price_cache: setup.price_cache,
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_credit::instruction::PostPrice {
                price,
                expo,
                publish_time: self.slot() as i64,
            }
            .data(),
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
        scalar::solvency_scalars(p, a, self.profile.credit.haircut_bps).unwrap()
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
        let (transfer, ctxs) = self.build_confidential_transfer(
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
                borrower_cstock: tokens.cstock.address,
                instructions: crate::solana_instructions_sysvar_id(),
            }
            .to_account_metas(None),
            data: window_credit::instruction::DepositCollateral {}.data(),
        };
        let stats = self.send(&wallet, &[transfer, ix_dep], &[])?;
        self.close_contexts(&wallet, &ctxs);
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
                    price_cache: setup.price_cache,
                    loan: *loan,
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
        let (transfer, ctxs) = self.build_confidential_transfer(
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
                destination: *destination,
                instructions: crate::solana_instructions_sysvar_id(),
            }
            .to_account_metas(None),
            data: window_credit::instruction::ReleaseCollateral {}.data(),
        };
        let stats = self.send(&op, &[transfer, ix_rel], &[])?;
        self.close_contexts(&op, &ctxs);
        Ok(stats)
    }
}
