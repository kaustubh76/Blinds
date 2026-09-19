//! Token-2022 confidential-transfer plans: chain-agnostic instruction sequences with the proofs
//! they need. The caller sends the setup transactions first (they may each need a fresh
//! context-account keypair as signer), then the main instruction (with any program instruction
//! that must follow it in the same transaction), then the close instructions.

use std::num::NonZeroI8;

use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_zk_elgamal_proof_interface::proof_data::{
    BatchedGroupedCiphertext3HandlesValidityProofContext, BatchedRangeProofContext,
    CiphertextCommitmentEqualityProofContext,
};
use solana_zk_sdk::{
    encryption::{
        auth_encryption::{AeCiphertext, AeKey},
        derivation::derive_confidential_keys_from_ikm,
        elgamal::{ElGamalCiphertext, ElGamalKeypair, ElGamalPubkey},
    },
    zk_elgamal_proof_program::{build_pubkey_validity_proof_data, VerifyZkProof},
};
use solana_zk_sdk_pod::encryption::{auth_encryption::PodAeCiphertext, elgamal::PodElGamalPubkey};
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
use window_proofs::ix as zk;

pub fn token_2022() -> Pubkey {
    spl_token_2022_interface::id()
}

/// A transaction to send: instructions plus the extra keypairs that must sign (the fee payer
/// signs implicitly).
pub struct Tx {
    pub instructions: Vec<Instruction>,
    pub extra_signers: Vec<Keypair>,
}

/// Space and instruction list to create a mint with the given extensions; `rent` is for `space`.
pub fn create_mint_plan(
    payer: &Pubkey,
    mint: &Keypair,
    extensions: &[ExtensionType],
    ext_ixs: Vec<Instruction>,
    authority: &Pubkey,
    decimals: u8,
    rent: u64,
) -> Tx {
    let space = mint_space(extensions);
    let mut instructions = vec![solana_system_interface::instruction::create_account(
        payer,
        &mint.pubkey(),
        rent,
        space as u64,
        &token_2022(),
    )];
    instructions.extend(ext_ixs);
    instructions.push(
        token_ix::initialize_mint2(&token_2022(), &mint.pubkey(), authority, None, decimals)
            .unwrap(),
    );
    Tx { instructions, extra_signers: vec![mint.insecure_clone()] }
}

pub fn mint_space(extensions: &[ExtensionType]) -> usize {
    ExtensionType::try_calculate_account_len::<MintState>(extensions).unwrap()
}

/// Mock xStock extensions: `ScaledUiAmount` + `PermanentDelegate`.
pub fn mock_xstock_extensions(
    mint: &Pubkey,
    authority: &Pubkey,
    multiplier: f64,
) -> (Vec<ExtensionType>, Vec<Instruction>) {
    (
        vec![ExtensionType::ScaledUiAmount, ExtensionType::PermanentDelegate],
        vec![
            scaled_ui_amount::instruction::initialize(
                &token_2022(),
                mint,
                Some(*authority),
                multiplier,
            )
            .unwrap(),
            token_ix::initialize_permanent_delegate(&token_2022(), mint, authority).unwrap(),
        ],
    )
}

/// Confidential mint extension with an auditor.
pub fn confidential_mint_extensions(
    mint: &Pubkey,
    authority: &Pubkey,
    auditor: &ElGamalPubkey,
) -> (Vec<ExtensionType>, Vec<Instruction>) {
    (
        vec![ExtensionType::ConfidentialTransferMint],
        vec![ct::initialize_mint(
            &token_2022(),
            mint,
            Some(*authority),
            true,
            Some(PodElGamalPubkey::from(*auditor)),
        )
        .unwrap()],
    )
}

pub fn update_multiplier(mint: &Pubkey, authority: &Pubkey, multiplier: f64) -> Instruction {
    scaled_ui_amount::instruction::update_multiplier(
        &token_2022(),
        mint,
        authority,
        &[],
        multiplier,
        0,
    )
    .unwrap()
}

pub fn token_account_space(confidential: bool) -> usize {
    let ext: &[ExtensionType] =
        if confidential { &[ExtensionType::ConfidentialTransferAccount] } else { &[] };
    ExtensionType::try_calculate_account_len::<TokenAccountState>(ext).unwrap()
}

/// A plain Token-2022 account.
pub fn create_token_account_plan(
    owner: &Pubkey,
    account: &Keypair,
    mint: &Pubkey,
    rent: u64,
) -> Tx {
    Tx {
        instructions: vec![
            solana_system_interface::instruction::create_account(
                owner,
                &account.pubkey(),
                rent,
                token_account_space(false) as u64,
                &token_2022(),
            ),
            token_ix::initialize_account3(&token_2022(), &account.pubkey(), mint, owner).unwrap(),
        ],
        extra_signers: vec![account.insecure_clone()],
    }
}

pub fn mint_to(mint: &Pubkey, to: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    token_ix::mint_to(&token_2022(), mint, to, authority, &[], amount).unwrap()
}

/// Associated-token-program `CreateIdempotent` (discriminant 1) for a Token-2022 mint; `payer`
/// funds the rent so a wallet without SOL can be given a token account.
pub fn create_ata_idempotent(payer: &Pubkey, owner: &Pubkey, mint: &Pubkey) -> Instruction {
    use solana_instruction::AccountMeta;
    Instruction {
        program_id: crate::pda::ASSOCIATED_TOKEN_PROGRAM,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(crate::pda::ata(owner, mint), false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
            AccountMeta::new_readonly(token_2022(), false),
        ],
        data: vec![1],
    }
}

/// The keys of a confidential token account.
pub struct ConfidentialKeys {
    pub elgamal: ElGamalKeypair,
    pub ae: AeKey,
}

impl ConfidentialKeys {
    pub fn random() -> Self {
        Self { elgamal: ElGamalKeypair::new_rand(), ae: AeKey::new_rand() }
    }
    /// Derived from a stored seed (services) — deterministic across restarts; the same HKDF
    /// derivation Token-2022 tooling uses for wallet signatures.
    pub fn from_seed(seed: &[u8; 32], label: &str) -> Self {
        let mut s = seed.to_vec();
        s.extend_from_slice(label.as_bytes());
        let (elgamal, ae) = derive_confidential_keys_from_ikm(&s).expect("seed");
        Self { elgamal, ae }
    }
    /// From a wallet signature over `keys::signing_message(seed)`.
    pub fn from_signature(signature: &[u8; 64]) -> Self {
        let (elgamal, ae) = derive_confidential_keys_from_ikm(signature).expect("signature");
        Self { elgamal, ae }
    }
}

/// Create + configure a confidential token account (pubkey-validity proof inline).
pub fn create_confidential_account_plan(
    owner: &Pubkey,
    account: &Keypair,
    mint: &Pubkey,
    keys: &ConfidentialKeys,
    rent: u64,
) -> Tx {
    let proof = build_pubkey_validity_proof_data(&keys.elgamal).unwrap();
    // Verify what we are about to send with the SDK's own verifier: a proof the chain refuses is
    // then a validator-side fact, not a question about this binary (CI's Linux tier 2 hit exactly
    // that ambiguity). One sigma-proof verification, microseconds.
    proof
        .verify_proof()
        .expect("the pubkey-validity proof this binary generated must verify locally");
    let zero: PodAeCiphertext = keys.ae.encrypt(0).into();
    let mut instructions = vec![
        solana_system_interface::instruction::create_account(
            owner,
            &account.pubkey(),
            rent,
            token_account_space(true) as u64,
            &token_2022(),
        ),
        token_ix::initialize_account3(&token_2022(), &account.pubkey(), mint, owner).unwrap(),
    ];
    instructions.extend(
        ct::configure_account(
            &token_2022(),
            &account.pubkey(),
            mint,
            &zero,
            65_536,
            owner,
            &[],
            ProofLocation::InstructionOffset(NonZeroI8::new(1).unwrap(), &proof),
        )
        .unwrap(),
    );
    Tx { instructions, extra_signers: vec![account.insecure_clone()] }
}

/// Parses the confidential extension of a token account's data.
pub fn confidential_state(data: &[u8]) -> Option<ConfidentialTransferAccount> {
    let state = StateWithExtensions::<TokenAccountState>::unpack(data).ok()?;
    state.get_extension::<ConfidentialTransferAccount>().ok().copied()
}

pub fn token_amount(data: &[u8]) -> Option<u64> {
    StateWithExtensions::<TokenAccountState>::unpack(data).ok().map(|s| s.base.amount)
}

pub fn mint_supply(data: &[u8]) -> Option<u64> {
    StateWithExtensions::<MintState>::unpack(data).ok().map(|s| s.base.supply)
}

/// Owner-side view of a confidential balance from account data: (available, pending).
pub fn balances(
    state: &ConfidentialTransferAccount,
    keys: &ConfidentialKeys,
) -> Option<(u64, u64)> {
    let ae: AeCiphertext = state.decryptable_available_balance.try_into().ok()?;
    let available = keys.ae.decrypt(&ae)?;
    let lo: ElGamalCiphertext = state.pending_balance_lo.try_into().ok()?;
    let hi: ElGamalCiphertext = state.pending_balance_hi.try_into().ok()?;
    let lo = keys.elgamal.secret().decrypt_u32(&lo)?;
    let hi = keys.elgamal.secret().decrypt_u32(&hi)?;
    Some((available, lo + (hi << 16)))
}

/// `ApplyPendingBalance` moving `pending` into `available`; the owner re-encrypts the new total.
pub fn apply_pending_balance(
    account: &Pubkey,
    owner: &Pubkey,
    state: &ConfidentialTransferAccount,
    keys: &ConfidentialKeys,
    new_available: u64,
) -> Instruction {
    let counter: u64 = state.pending_balance_credit_counter.into();
    let new_balance: PodAeCiphertext = keys.ae.encrypt(new_available).into();
    ct::apply_pending_balance(&token_2022(), account, counter, &new_balance, owner, &[]).unwrap()
}

/// A confidential transfer plan.
pub struct TransferPlan {
    /// Send in order, each as its own transaction (range proofs are large).
    pub setup: Vec<Tx>,
    /// The `Transfer` instruction; append a program instruction after it if it must be introspected.
    pub transfer: Instruction,
    /// Close the three contexts afterwards.
    pub close: Vec<Instruction>,
}

/// Builds a confidential transfer of `amount` from `source` (state + keys, tracked available
/// balance) to `destination` (its ElGamal pubkey from its own extension) under `auditor`.
/// `rent_for` maps a context size to its rent-exempt minimum.
#[allow(clippy::too_many_arguments)]
pub fn transfer_plan(
    owner: &Pubkey,
    source: &Pubkey,
    source_state: &ConfidentialTransferAccount,
    keys: &ConfidentialKeys,
    current_available: u64,
    mint: &Pubkey,
    destination: &Pubkey,
    destination_elgamal: &ElGamalPubkey,
    auditor: Option<&ElGamalPubkey>,
    amount: u64,
    rent_for: &dyn Fn(usize) -> u64,
) -> Result<TransferPlan, String> {
    let available: ElGamalCiphertext =
        source_state.available_balance.try_into().map_err(|_| "available balance")?;
    let decryptable: AeCiphertext =
        source_state.decryptable_available_balance.try_into().map_err(|_| "decryptable balance")?;
    let proofs = transfer_split_proof_data(
        &available,
        &decryptable,
        amount,
        &keys.elgamal,
        &keys.ae,
        destination_elgamal,
        auditor,
    )
    .map_err(|e| format!("transfer proofs: {e}"))?;
    let eq_ctx = Keypair::new();
    let val_ctx = Keypair::new();
    let range_ctx = Keypair::new();
    let [c_eq, v_eq] = zk::create_and_verify(
        owner,
        &eq_ctx.pubkey(),
        owner,
        rent_for(zk::context_size::<CiphertextCommitmentEqualityProofContext>()),
        &proofs.equality_proof_data,
    );
    let [c_val, v_val] = zk::create_and_verify(
        owner,
        &val_ctx.pubkey(),
        owner,
        rent_for(zk::context_size::<BatchedGroupedCiphertext3HandlesValidityProofContext>()),
        &proofs.ciphertext_validity_proof_data_with_ciphertext.proof_data,
    );
    let [c_range, v_range] = zk::create_and_verify(
        owner,
        &range_ctx.pubkey(),
        owner,
        rent_for(zk::context_size::<BatchedRangeProofContext>()),
        &proofs.range_proof_data,
    );
    let new_balance: PodAeCiphertext = keys
        .ae
        .encrypt(current_available.checked_sub(amount).ok_or("insufficient available balance")?)
        .into();
    let mut ixs = ct::transfer(
        &token_2022(),
        source,
        mint,
        destination,
        &new_balance,
        &proofs.ciphertext_validity_proof_data_with_ciphertext.ciphertext_lo,
        &proofs.ciphertext_validity_proof_data_with_ciphertext.ciphertext_hi,
        owner,
        &[],
        ProofLocation::ContextStateAccount(&eq_ctx.pubkey()),
        ProofLocation::ContextStateAccount(&val_ctx.pubkey()),
        ProofLocation::ContextStateAccount(&range_ctx.pubkey()),
    )
    .map_err(|e| e.to_string())?;
    let close = vec![
        zk::close(&eq_ctx.pubkey(), owner, owner),
        zk::close(&val_ctx.pubkey(), owner, owner),
        zk::close(&range_ctx.pubkey(), owner, owner),
    ];
    Ok(TransferPlan {
        setup: vec![
            Tx { instructions: vec![c_eq, v_eq], extra_signers: vec![eq_ctx] },
            Tx { instructions: vec![c_val, v_val], extra_signers: vec![val_ctx] },
            Tx { instructions: vec![c_range], extra_signers: vec![range_ctx] },
            Tx { instructions: vec![v_range], extra_signers: vec![] },
        ],
        transfer: ixs.remove(0),
        close,
    })
}

/// A confidential withdraw plan (available → public balance).
pub fn withdraw_plan(
    owner: &Pubkey,
    account: &Pubkey,
    state: &ConfidentialTransferAccount,
    keys: &ConfidentialKeys,
    current_available: u64,
    mint: &Pubkey,
    decimals: u8,
    amount: u64,
    rent_for: &dyn Fn(usize) -> u64,
) -> Result<TransferPlan, String> {
    let available: ElGamalCiphertext =
        state.available_balance.try_into().map_err(|_| "available balance")?;
    let proofs = withdraw_proof_data(&available, current_available, amount, &keys.elgamal)
        .map_err(|e| format!("withdraw proofs: {e}"))?;
    let eq_ctx = Keypair::new();
    let range_ctx = Keypair::new();
    let [c_eq, v_eq] = zk::create_and_verify(
        owner,
        &eq_ctx.pubkey(),
        owner,
        rent_for(zk::context_size::<CiphertextCommitmentEqualityProofContext>()),
        &proofs.equality_proof_data,
    );
    let [c_range, v_range] = zk::create_and_verify(
        owner,
        &range_ctx.pubkey(),
        owner,
        rent_for(zk::context_size::<BatchedRangeProofContext>()),
        &proofs.range_proof_data,
    );
    let new_balance: PodAeCiphertext =
        keys.ae.encrypt(current_available.checked_sub(amount).ok_or("insufficient")?).into();
    let mut ixs = ct::withdraw(
        &token_2022(),
        account,
        mint,
        amount,
        decimals,
        &new_balance,
        owner,
        &[],
        ProofLocation::ContextStateAccount(&eq_ctx.pubkey()),
        ProofLocation::ContextStateAccount(&range_ctx.pubkey()),
    )
    .map_err(|e| e.to_string())?;
    Ok(TransferPlan {
        setup: vec![
            Tx { instructions: vec![c_eq, v_eq], extra_signers: vec![eq_ctx.insecure_clone()] },
            Tx { instructions: vec![c_range], extra_signers: vec![range_ctx.insecure_clone()] },
            Tx { instructions: vec![v_range], extra_signers: vec![] },
        ],
        transfer: ixs.remove(0),
        close: vec![
            zk::close(&eq_ctx.pubkey(), owner, owner),
            zk::close(&range_ctx.pubkey(), owner, owner),
        ],
    })
}

#[cfg(test)]
mod proof_self_check {
    //! The proofs this crate generates verify with the SDK's own verifier — in every build profile.
    //! (CI's tier 2 once failed `VerifyPubkeyValidity` on Linux with the release-built service while
    //! the same code passed on macOS; this pins generation and verification together per platform.)
    use solana_zk_sdk::zk_elgamal_proof_program::{
        build_pubkey_validity_proof_data, VerifyZkProof,
    };

    #[test]
    fn pubkey_validity_proof_verifies_for_seeded_keys() {
        for label in ["thewindow:escrow:v1", "thewindow:agent-token:0", "x"] {
            let keys = super::ConfidentialKeys::from_seed(&[0x11; 32], label);
            let data = build_pubkey_validity_proof_data(&keys.elgamal).expect("proof");
            data.verify_proof().expect("the proof we generate must verify");
        }
    }
}

#[cfg(test)]
mod cross_platform_fixture {
    //! Key derivation and proof verification must agree across platforms. The fixture was made on
    //! macOS arm64, where the real validator accepts these proofs; a platform that derives another
    //! pubkey from the same seed, or rejects this proof, has an arithmetic problem of its own.
    use solana_zk_sdk::zk_elgamal_proof_program::VerifyZkProof;

    const SEED: [u8; 32] = [0x11; 32];
    const LABEL: &str = "thewindow:escrow:v1";

    /// Regenerates the fixture: `cargo test -p window-client print_fixture -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn print_fixture() {
        let keys = super::ConfidentialKeys::from_seed(&SEED, LABEL);
        let data = solana_zk_sdk::zk_elgamal_proof_program::build_pubkey_validity_proof_data(
            &keys.elgamal,
        )
        .expect("proof");
        let bytes = bytemuck::bytes_of(&data);
        println!("PUBKEY_HEX={}", hex::encode(keys.elgamal.pubkey().to_bytes()));
        println!("PROOF_HEX={}", hex::encode(bytes));
    }

    #[test]
    fn escrow_pubkey_and_a_macos_proof_verify_here() {
        let keys = super::ConfidentialKeys::from_seed(&SEED, LABEL);
        assert_eq!(
            hex::encode(keys.elgamal.pubkey().to_bytes()),
            PUBKEY_HEX,
            "pubkey derivation differs on this platform"
        );
        let bytes = hex::decode(PROOF_HEX).unwrap();
        let data: &solana_zk_elgamal_proof_interface::proof_data::PubkeyValidityProofData =
            bytemuck::from_bytes(&bytes);
        data.verify_proof().expect("a proof the macOS validator accepts must verify here");
    }

    const PUBKEY_HEX: &str = "1e526727854eb5fef02fe5a9e52990fbc9c9b15ebe2097e4b192bcbc21372f1e";
    const PROOF_HEX: &str = "1e526727854eb5fef02fe5a9e52990fbc9c9b15ebe2097e4b192bcbc21372f1e4894cef49d52a0edb9a25f979d54adb695ef43827bc08852ae5b56b6b5bb8958b7c545c51c99d2f9058d41543dedf56e6ec52c0bd24e4bf244df9ea9ab980d0d";
}
