//! Token-2022 confidential-transfer plumbing for the harness: mints with extensions, account
//! configuration, apply-pending, and confidential transfers with their three proofs. This is
//! exactly what the SDK does in TypeScript for a judge's wallet; here it is Rust so tier-1 tests
//! exercise the real Token-2022 program bundled with LiteSVM.

use std::num::NonZeroI8;

use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_zk_sdk::{
    encryption::{
        auth_encryption::{AeCiphertext, AeKey},
        elgamal::{ElGamalCiphertext, ElGamalKeypair, ElGamalPubkey},
        pod::{auth_encryption::PodAeCiphertext, elgamal::PodElGamalPubkey},
    },
    zk_elgamal_proof_program::proof_data::{
        BatchedGroupedCiphertext3HandlesValidityProofContext, BatchedRangeProofContext,
        CiphertextCommitmentEqualityProofContext, PubkeyValidityProofData,
    },
};
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::{instruction as ct, ConfidentialTransferAccount},
        scaled_ui_amount, BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
    instruction as token_ix,
    state::{Account as TokenAccountState, Mint as MintState},
};
use spl_token_confidential_transfer_proof_extraction::instruction::ProofLocation;
use spl_token_confidential_transfer_proof_generation::{
    transfer::transfer_split_proof_data, withdraw::withdraw_proof_data,
};
use window_proofs::ix;

use crate::{Harness, TxError, TxStats};

/// Token-2022 program id.
pub fn token_2022() -> Pubkey {
    spl_token_2022_interface::id()
}

/// A confidential token account and the keys that operate it.
pub struct ConfidentialAccount {
    pub address: Pubkey,
    pub owner: Pubkey,
    pub elgamal: ElGamalKeypair,
    pub ae: AeKey,
    /// Plaintext available balance as tracked by the owner (what the AE ciphertext encrypts).
    pub available: u64,
}

impl Harness {
    /// Creates a Token-2022 mint with the given extension-initialisation instructions
    /// (executed between account creation and `initialize_mint2`).
    pub fn create_mint(
        &mut self,
        extensions: &[ExtensionType],
        ext_ixs: impl FnOnce(&Pubkey) -> Vec<Instruction>,
        authority: &Pubkey,
        decimals: u8,
    ) -> Pubkey {
        let mint = Keypair::new();
        let space = ExtensionType::try_calculate_account_len::<MintState>(extensions).unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(space);
        let admin = self.admin.insecure_clone();
        let mut ixs = vec![solana_system_interface::instruction::create_account(
            &admin.pubkey(),
            &mint.pubkey(),
            rent,
            space as u64,
            &token_2022(),
        )];
        ixs.extend(ext_ixs(&mint.pubkey()));
        ixs.push(
            token_ix::initialize_mint2(&token_2022(), &mint.pubkey(), authority, None, decimals)
                .unwrap(),
        );
        self.send(&admin, &ixs, &[&mint]).expect("create mint");
        mint.pubkey()
    }

    /// Mock xStock: `ScaledUiAmount` (the rebasing multiplier) + `PermanentDelegate`, like the real asset.
    pub fn create_mock_xstock_mint(&mut self, decimals: u8, multiplier: f64) -> Pubkey {
        let admin = self.admin.pubkey();
        self.create_mint(
            &[ExtensionType::ScaledUiAmount, ExtensionType::PermanentDelegate],
            |mint| {
                vec![
                    scaled_ui_amount::instruction::initialize(
                        &token_2022(),
                        mint,
                        Some(admin),
                        multiplier,
                    )
                    .unwrap(),
                    token_ix::initialize_permanent_delegate(&token_2022(), mint, &admin).unwrap(),
                ]
            },
            &admin,
            decimals,
        )
    }

    /// Confidential wrapped mint with the auditor key and the given mint authority.
    pub fn create_confidential_mint(&mut self, mint_authority: &Pubkey, decimals: u8) -> Pubkey {
        let admin = self.admin.pubkey();
        let auditor = PodElGamalPubkey::from(*self.auditor.pubkey());
        self.create_mint(
            &[ExtensionType::ConfidentialTransferMint],
            |mint| {
                vec![ct::initialize_mint(&token_2022(), mint, Some(admin), true, Some(auditor))
                    .unwrap()]
            },
            mint_authority,
            decimals,
        )
    }

    /// Updates the rebasing multiplier (the corporate-action event).
    pub fn set_multiplier(&mut self, mint: &Pubkey, multiplier: f64) {
        let admin = self.admin.insecure_clone();
        let ix = scaled_ui_amount::instruction::update_multiplier(
            &token_2022(),
            mint,
            &admin.pubkey(),
            &[],
            multiplier,
            0,
        )
        .unwrap();
        self.send(&admin, &[ix], &[]).expect("update multiplier");
    }

    /// A plain Token-2022 account for `mint` owned by `owner` (mock-xStock side).
    pub fn create_token_account(&mut self, mint: &Pubkey, owner: &Keypair) -> Pubkey {
        let acc = Keypair::new();
        let space = ExtensionType::try_calculate_account_len::<TokenAccountState>(&[]).unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(space);
        let ixs = vec![
            solana_system_interface::instruction::create_account(
                &owner.pubkey(),
                &acc.pubkey(),
                rent,
                space as u64,
                &token_2022(),
            ),
            token_ix::initialize_account3(&token_2022(), &acc.pubkey(), mint, &owner.pubkey())
                .unwrap(),
        ];
        self.send(owner, &ixs, &[&acc]).expect("create token account");
        acc.pubkey()
    }

    /// Mints `amount` of a mint whose authority is the admin.
    pub fn mint_to(&mut self, mint: &Pubkey, to: &Pubkey, amount: u64) {
        let admin = self.admin.insecure_clone();
        let ix = token_ix::mint_to(&token_2022(), mint, to, &admin.pubkey(), &[], amount).unwrap();
        self.send(&admin, &[ix], &[]).expect("mint_to");
    }

    /// Creates and configures a confidential token account (pubkey-validity proof inline).
    pub fn create_confidential_account(
        &mut self,
        mint: &Pubkey,
        owner: &Keypair,
    ) -> ConfidentialAccount {
        let acc = Keypair::new();
        let elgamal = ElGamalKeypair::new_rand();
        let ae = AeKey::new_rand();
        let space = ExtensionType::try_calculate_account_len::<TokenAccountState>(&[
            ExtensionType::ConfidentialTransferAccount,
        ])
        .unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(space);
        let proof = PubkeyValidityProofData::new(&elgamal).unwrap();
        let zero: PodAeCiphertext = ae.encrypt(0).into();
        let mut ixs = vec![
            solana_system_interface::instruction::create_account(
                &owner.pubkey(),
                &acc.pubkey(),
                rent,
                space as u64,
                &token_2022(),
            ),
            token_ix::initialize_account3(&token_2022(), &acc.pubkey(), mint, &owner.pubkey())
                .unwrap(),
        ];
        ixs.extend(
            ct::configure_account(
                &token_2022(),
                &acc.pubkey(),
                mint,
                &zero,
                65_536,
                &owner.pubkey(),
                &[],
                ProofLocation::InstructionOffset(NonZeroI8::new(1).unwrap(), &proof),
            )
            .unwrap(),
        );
        self.send(owner, &ixs, &[&acc]).expect("configure confidential account");
        ConfidentialAccount {
            address: acc.pubkey(),
            owner: owner.pubkey(),
            elgamal,
            ae,
            available: 0,
        }
    }

    /// Reads the confidential extension of a token account.
    pub fn confidential_state(&self, account: &Pubkey) -> ConfidentialTransferAccount {
        let data = self.svm.get_account(account).expect("token account").data;
        let state = StateWithExtensions::<TokenAccountState>::unpack(&data).unwrap();
        *state.get_extension::<ConfidentialTransferAccount>().unwrap()
    }

    /// Public (non-confidential) balance of a Token-2022 account.
    pub fn token_balance(&self, account: &Pubkey) -> u64 {
        let data = self.svm.get_account(account).expect("token account").data;
        StateWithExtensions::<TokenAccountState>::unpack(&data).unwrap().base.amount
    }

    /// Mint supply.
    pub fn mint_supply(&self, mint: &Pubkey) -> u64 {
        let data = self.svm.get_account(mint).expect("mint").data;
        StateWithExtensions::<MintState>::unpack(&data).unwrap().base.supply
    }

    /// Moves the pending confidential balance into the available balance (no ZK proof; the owner
    /// re-encrypts the new total with its AE key). `credited` is what landed in pending.
    pub fn apply_pending_balance(
        &mut self,
        acc: &mut ConfidentialAccount,
        owner: &Keypair,
        credited: u64,
    ) -> Result<TxStats, TxError> {
        let state = self.confidential_state(&acc.address);
        let counter: u64 = state.pending_balance_credit_counter.into();
        acc.available += credited;
        let new_balance: PodAeCiphertext = acc.ae.encrypt(acc.available).into();
        let ix = ct::apply_pending_balance(
            &token_2022(),
            &acc.address,
            counter,
            &new_balance,
            &owner.pubkey(),
            &[],
        )
        .unwrap();
        self.send(owner, &[ix], &[])
    }

    /// Whether the account's available balance decrypts to what the owner tracks (owner-side check).
    pub fn available_matches(&self, acc: &ConfidentialAccount) -> bool {
        let state = self.confidential_state(&acc.address);
        let ct: ElGamalCiphertext = state.available_balance.try_into().unwrap();
        let ae: AeCiphertext = state.decryptable_available_balance.try_into().unwrap();
        acc.ae.decrypt(&ae) == Some(acc.available)
            && acc.elgamal.secret().decrypt_u32(&ct) == Some(acc.available)
    }

    /// Builds the confidential transfer instruction sequence `source → destination` for `amount`:
    /// returns (setup transactions to send first, the transfer instruction, context accounts to
    /// close afterwards). The caller appends its own instruction after the transfer (e.g.
    /// `deposit_collateral`) so a program can introspect it.
    pub fn build_confidential_transfer(
        &mut self,
        source: &mut ConfidentialAccount,
        owner: &Keypair,
        mint: &Pubkey,
        destination: &Pubkey,
        amount: u64,
    ) -> Result<(Instruction, Vec<Pubkey>), TxError> {
        let state = self.confidential_state(&source.address);
        let available: ElGamalCiphertext = state.available_balance.try_into().unwrap();
        let decryptable: AeCiphertext = state.decryptable_available_balance.try_into().unwrap();
        let dest_state = self.confidential_state(destination);
        let dest_pk: ElGamalPubkey = dest_state.elgamal_pubkey.try_into().unwrap();
        let auditor = self.auditor.pubkey().clone();
        let proofs = transfer_split_proof_data(
            &available,
            &decryptable,
            amount,
            &source.elgamal,
            &source.ae,
            &dest_pk,
            Some(&auditor),
        )
        .map_err(|e| TxError { error: format!("transfer proofs: {e}"), logs: vec![] })?;
        // Context accounts: equality, ciphertext validity (3 handles), range (u128).
        let eq_ctx = Keypair::new();
        let val_ctx = Keypair::new();
        let range_ctx = Keypair::new();
        let rent_eq = self.svm.minimum_balance_for_rent_exemption(ix::context_size::<
            CiphertextCommitmentEqualityProofContext,
        >());
        let rent_val = self.svm.minimum_balance_for_rent_exemption(ix::context_size::<
            BatchedGroupedCiphertext3HandlesValidityProofContext,
        >());
        let rent_range = self
            .svm
            .minimum_balance_for_rent_exemption(ix::context_size::<BatchedRangeProofContext>());
        let [c_eq, v_eq] = ix::create_and_verify(
            &owner.pubkey(),
            &eq_ctx.pubkey(),
            &owner.pubkey(),
            rent_eq,
            &proofs.equality_proof_data,
        );
        let [c_val, v_val] = ix::create_and_verify(
            &owner.pubkey(),
            &val_ctx.pubkey(),
            &owner.pubkey(),
            rent_val,
            &proofs.ciphertext_validity_proof_data_with_ciphertext.proof_data,
        );
        let [c_range, v_range] = ix::create_and_verify(
            &owner.pubkey(),
            &range_ctx.pubkey(),
            &owner.pubkey(),
            rent_range,
            &proofs.range_proof_data,
        );
        self.send(owner, &[c_eq, v_eq], &[&eq_ctx])?;
        self.send(owner, &[c_val, v_val], &[&val_ctx])?;
        self.send(owner, &[c_range], &[&range_ctx])?;
        self.send(owner, &[v_range], &[])?;
        source.available -= amount;
        let new_balance: PodAeCiphertext = source.ae.encrypt(source.available).into();
        let ixs = ct::transfer(
            &token_2022(),
            &source.address,
            mint,
            destination,
            &new_balance,
            &proofs.ciphertext_validity_proof_data_with_ciphertext.ciphertext_lo,
            &proofs.ciphertext_validity_proof_data_with_ciphertext.ciphertext_hi,
            &owner.pubkey(),
            &[],
            ProofLocation::ContextStateAccount(&eq_ctx.pubkey()),
            ProofLocation::ContextStateAccount(&val_ctx.pubkey()),
            ProofLocation::ContextStateAccount(&range_ctx.pubkey()),
        )
        .unwrap();
        assert_eq!(ixs.len(), 1, "context-account proofs yield a single transfer instruction");
        Ok((
            ixs.into_iter().next().unwrap(),
            vec![eq_ctx.pubkey(), val_ctx.pubkey(), range_ctx.pubkey()],
        ))
    }

    /// Confidential → public balance for `amount` (equality + 64-bit range proof in context accounts).
    pub fn confidential_withdraw(
        &mut self,
        acc: &mut ConfidentialAccount,
        owner: &Keypair,
        mint: &Pubkey,
        decimals: u8,
        amount: u64,
    ) -> Result<TxStats, TxError> {
        let state = self.confidential_state(&acc.address);
        let available: ElGamalCiphertext = state.available_balance.try_into().unwrap();
        let proofs = withdraw_proof_data(&available, acc.available, amount, &acc.elgamal)
            .map_err(|e| TxError { error: format!("withdraw proofs: {e}"), logs: vec![] })?;
        let eq_ctx = Keypair::new();
        let range_ctx = Keypair::new();
        let rent_eq = self.svm.minimum_balance_for_rent_exemption(ix::context_size::<
            CiphertextCommitmentEqualityProofContext,
        >());
        let rent_range = self
            .svm
            .minimum_balance_for_rent_exemption(ix::context_size::<BatchedRangeProofContext>());
        let [c_eq, v_eq] = ix::create_and_verify(
            &owner.pubkey(),
            &eq_ctx.pubkey(),
            &owner.pubkey(),
            rent_eq,
            &proofs.equality_proof_data,
        );
        let [c_range, v_range] = ix::create_and_verify(
            &owner.pubkey(),
            &range_ctx.pubkey(),
            &owner.pubkey(),
            rent_range,
            &proofs.range_proof_data,
        );
        self.send(owner, &[c_eq, v_eq], &[&eq_ctx])?;
        self.send(owner, &[c_range], &[&range_ctx])?;
        self.send(owner, &[v_range], &[])?;
        acc.available -= amount;
        let new_balance: PodAeCiphertext = acc.ae.encrypt(acc.available).into();
        let ixs = ct::withdraw(
            &token_2022(),
            &acc.address,
            mint,
            amount,
            decimals,
            &new_balance,
            &owner.pubkey(),
            &[],
            ProofLocation::ContextStateAccount(&eq_ctx.pubkey()),
            ProofLocation::ContextStateAccount(&range_ctx.pubkey()),
        )
        .unwrap();
        let stats = self.send(owner, &ixs, &[])?;
        self.close_contexts(owner, &[eq_ctx.pubkey(), range_ctx.pubkey()]);
        Ok(stats)
    }

    /// Closes proof context accounts owned by `owner`.
    pub fn close_contexts(&mut self, owner: &Keypair, ctxs: &[Pubkey]) {
        let ixs: Vec<Instruction> =
            ctxs.iter().map(|c| ix::close(c, &owner.pubkey(), &owner.pubkey())).collect();
        self.send(owner, &ixs, &[]).expect("close contexts");
    }
}
