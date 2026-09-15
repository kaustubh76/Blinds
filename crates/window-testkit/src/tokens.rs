//! Token-2022 confidential-transfer operations for the harness, executed on LiteSVM through the
//! same chain-agnostic plans (`window_client::ct`) the services and agents use.

use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use spl_token_2022_interface::extension::{
    confidential_transfer::ConfidentialTransferAccount, ExtensionType,
};
use window_client::ct::{self, ConfidentialKeys, Tx};

use crate::{Harness, TxError, TxStats};

pub use window_client::ct::token_2022;

/// A confidential token account and the keys that operate it.
pub struct ConfidentialAccount {
    pub address: Pubkey,
    pub owner: Pubkey,
    pub keys: ConfidentialKeys,
    /// Plaintext available balance as tracked by the owner (what the AE ciphertext encrypts).
    pub available: u64,
}

impl Harness {
    fn send_tx(&mut self, payer: &Keypair, tx: &Tx) -> Result<TxStats, TxError> {
        let extra: Vec<&Keypair> = tx.extra_signers.iter().collect();
        self.send(payer, &tx.instructions, &extra)
    }

    /// Creates a Token-2022 mint with the given extension-initialisation instructions.
    pub fn create_mint(
        &mut self,
        extensions: &[ExtensionType],
        ext_ixs: impl FnOnce(&Pubkey) -> Vec<Instruction>,
        authority: &Pubkey,
        decimals: u8,
    ) -> Pubkey {
        let mint = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(ct::mint_space(extensions));
        let admin = self.admin.insecure_clone();
        let tx = ct::create_mint_plan(
            &admin.pubkey(),
            &mint,
            extensions,
            ext_ixs(&mint.pubkey()),
            authority,
            decimals,
            rent,
        );
        self.send_tx(&admin, &tx).expect("create mint");
        mint.pubkey()
    }

    /// Mock xStock: `ScaledUiAmount` (the rebasing multiplier) + `PermanentDelegate`, like the real asset.
    pub fn create_mock_xstock_mint(&mut self, decimals: u8, multiplier: f64) -> Pubkey {
        let admin = self.admin.pubkey();
        let mint = Keypair::new();
        let (ext, ixs) = ct::mock_xstock_extensions(&mint.pubkey(), &admin, multiplier);
        let rent = self.svm.minimum_balance_for_rent_exemption(ct::mint_space(&ext));
        let tx = ct::create_mint_plan(&admin, &mint, &ext, ixs, &admin, decimals, rent);
        let a = self.admin.insecure_clone();
        self.send_tx(&a, &tx).expect("mock mint");
        mint.pubkey()
    }

    /// Confidential wrapped mint with the auditor key and the given mint authority.
    pub fn create_confidential_mint(&mut self, mint_authority: &Pubkey, decimals: u8) -> Pubkey {
        let admin = self.admin.pubkey();
        let mint = Keypair::new();
        let (ext, ixs) =
            ct::confidential_mint_extensions(&mint.pubkey(), &admin, self.auditor.pubkey());
        let rent = self.svm.minimum_balance_for_rent_exemption(ct::mint_space(&ext));
        let tx = ct::create_mint_plan(&admin, &mint, &ext, ixs, mint_authority, decimals, rent);
        let a = self.admin.insecure_clone();
        self.send_tx(&a, &tx).expect("confidential mint");
        mint.pubkey()
    }

    /// Updates the rebasing multiplier (the corporate-action event).
    pub fn set_multiplier(&mut self, mint: &Pubkey, multiplier: f64) {
        let admin = self.admin.insecure_clone();
        self.send(&admin, &[ct::update_multiplier(mint, &admin.pubkey(), multiplier)], &[])
            .expect("update multiplier");
    }

    /// A plain Token-2022 account for `mint` owned by `owner` (mock-xStock side).
    pub fn create_token_account(&mut self, mint: &Pubkey, owner: &Keypair) -> Pubkey {
        let acc = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(ct::token_account_space(false));
        let tx = ct::create_token_account_plan(&owner.pubkey(), &acc, mint, rent);
        self.send_tx(owner, &tx).expect("create token account");
        acc.pubkey()
    }

    /// Mints `amount` of a mint whose authority is the admin.
    pub fn mint_to(&mut self, mint: &Pubkey, to: &Pubkey, amount: u64) {
        let admin = self.admin.insecure_clone();
        self.send(&admin, &[ct::mint_to(mint, to, &admin.pubkey(), amount)], &[]).expect("mint_to");
    }

    /// Creates and configures a confidential token account (pubkey-validity proof inline).
    pub fn create_confidential_account(
        &mut self,
        mint: &Pubkey,
        owner: &Keypair,
    ) -> ConfidentialAccount {
        let acc = Keypair::new();
        let keys = ConfidentialKeys::random();
        let rent = self.svm.minimum_balance_for_rent_exemption(ct::token_account_space(true));
        let tx = ct::create_confidential_account_plan(&owner.pubkey(), &acc, mint, &keys, rent);
        self.send_tx(owner, &tx).expect("configure confidential account");
        ConfidentialAccount { address: acc.pubkey(), owner: owner.pubkey(), keys, available: 0 }
    }

    /// Reads the confidential extension of a token account.
    pub fn confidential_state(&self, account: &Pubkey) -> ConfidentialTransferAccount {
        ct::confidential_state(&self.svm.get_account(account).expect("token account").data)
            .expect("confidential extension")
    }

    /// Public (non-confidential) balance of a Token-2022 account.
    pub fn token_balance(&self, account: &Pubkey) -> u64 {
        ct::token_amount(&self.svm.get_account(account).expect("token account").data).unwrap()
    }

    /// Mint supply.
    pub fn mint_supply(&self, mint: &Pubkey) -> u64 {
        ct::mint_supply(&self.svm.get_account(mint).expect("mint").data).unwrap()
    }

    /// Moves the pending confidential balance into the available balance. `credited` is what landed in pending.
    pub fn apply_pending_balance(
        &mut self,
        acc: &mut ConfidentialAccount,
        owner: &Keypair,
        credited: u64,
    ) -> Result<TxStats, TxError> {
        let state = self.confidential_state(&acc.address);
        acc.available += credited;
        let ix = ct::apply_pending_balance(
            &acc.address,
            &owner.pubkey(),
            &state,
            &acc.keys,
            acc.available,
        );
        self.send(owner, &[ix], &[])
    }

    /// Whether the account's balances decrypt to what the owner tracks (owner-side check).
    pub fn available_matches(&self, acc: &ConfidentialAccount) -> bool {
        let state = self.confidential_state(&acc.address);
        matches!(ct::balances(&state, &acc.keys), Some((a, 0)) if a == acc.available)
    }

    /// Builds and sends the setup of a confidential transfer; returns the transfer instruction
    /// (to be sent by the caller, possibly followed by a program instruction) and the contexts to close.
    pub fn build_confidential_transfer(
        &mut self,
        source: &mut ConfidentialAccount,
        owner: &Keypair,
        mint: &Pubkey,
        destination: &Pubkey,
        amount: u64,
    ) -> Result<(Instruction, Vec<Instruction>), TxError> {
        let state = self.confidential_state(&source.address);
        let dest_state = self.confidential_state(destination);
        let dest_pk = dest_state
            .elgamal_pubkey
            .try_into()
            .map_err(|_| TxError { error: "dest key".into(), logs: vec![] })?;
        let auditor = *self.auditor.pubkey();
        let rents: Vec<u64> = [
            window_proofs::ix::context_size::<solana_zk_elgamal_proof_interface::proof_data::CiphertextCommitmentEqualityProofContext>(),
            window_proofs::ix::context_size::<solana_zk_elgamal_proof_interface::proof_data::BatchedGroupedCiphertext3HandlesValidityProofContext>(),
            window_proofs::ix::context_size::<solana_zk_elgamal_proof_interface::proof_data::BatchedRangeProofContext>(),
        ]
        .iter()
        .map(|s| self.svm.minimum_balance_for_rent_exemption(*s))
        .collect();
        let rent_for = |space: usize| -> u64 {
            // sizes map 1:1 onto the three contexts; LiteSVM rent is linear in space so recompute
            let lamports_per_byte_year = rents[2] as f64
                / (window_proofs::ix::context_size::<
                    solana_zk_elgamal_proof_interface::proof_data::BatchedRangeProofContext,
                >() + 128) as f64;
            ((space + 128) as f64 * lamports_per_byte_year).ceil() as u64
        };
        let plan = ct::transfer_plan(
            &owner.pubkey(),
            &source.address,
            &state,
            &source.keys,
            source.available,
            mint,
            destination,
            &dest_pk,
            Some(&auditor),
            amount,
            &rent_for,
        )
        .map_err(|e| TxError { error: e, logs: vec![] })?;
        for tx in &plan.setup {
            self.send_tx(owner, tx)?;
        }
        source.available -= amount;
        Ok((plan.transfer, plan.close))
    }

    /// Confidential → public balance for `amount`.
    pub fn confidential_withdraw(
        &mut self,
        acc: &mut ConfidentialAccount,
        owner: &Keypair,
        mint: &Pubkey,
        decimals: u8,
        amount: u64,
    ) -> Result<TxStats, TxError> {
        let state = self.confidential_state(&acc.address);
        let rent_range =
            self.svm.minimum_balance_for_rent_exemption(window_proofs::ix::context_size::<
                solana_zk_elgamal_proof_interface::proof_data::BatchedRangeProofContext,
            >());
        let rent_for = |space: usize| -> u64 {
            let per_byte = rent_range as f64
                / (window_proofs::ix::context_size::<
                    solana_zk_elgamal_proof_interface::proof_data::BatchedRangeProofContext,
                >() + 128) as f64;
            ((space + 128) as f64 * per_byte).ceil() as u64
        };
        let plan = ct::withdraw_plan(
            &owner.pubkey(),
            &acc.address,
            &state,
            &acc.keys,
            acc.available,
            mint,
            decimals,
            amount,
            &rent_for,
        )
        .map_err(|e| TxError { error: e, logs: vec![] })?;
        for tx in &plan.setup {
            self.send_tx(owner, tx)?;
        }
        acc.available -= amount;
        let stats = self.send(owner, &[plan.transfer], &[])?;
        self.send(owner, &plan.close, &[])?;
        Ok(stats)
    }

    /// Closes proof context accounts owned by `owner` (instructions from a plan).
    pub fn close_contexts(&mut self, owner: &Keypair, close: &[Instruction]) {
        self.send(owner, close, &[]).expect("close contexts");
    }
}
