use solana_keypair::Keypair;
use solana_signer::Signer;
use window_credit::state::LoanStatus;

use crate::credit_fixture::{matched_loan, PRICE_TSLA, USDC};

#[test]
fn stale_price_at_lock_and_at_seize_are_both_rejected() {
    let mut f = matched_loan(200_000 * USDC);
    let scalars = f.h.current_scalars(&f.setup, 1.0);
    let (claim, pair) =
        f.h.build_lock_proofs(
            f.borrower,
            &f.h.loan(&f.loan),
            1_000_000,
            f.loan_size,
            &f.bid.opening,
            &scalars,
        )
        .unwrap();
    // Lock with a stale price: rejected (inaction).
    f.h.warp(f.h.profile.market.max_price_age_slots + 1);
    let err = f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap_err();
    assert!(err.has_code("PriceStale"), "{err}");
    // Fresh price: the same proofs lock.
    f.h.post_price(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    f.h.lock_collateral(&f.setup, f.borrower, &f.loan, &claim, &pair).unwrap();
    f.h.deposit_collateral(&f.setup, f.borrower, &mut f.tokens, &f.loan, 1_000_000).unwrap();
    f.h.confirm_lock(&f.setup, &f.loan).unwrap();
    f.h.confirm_funding(&f.setup, &f.loan).unwrap();
    // Seize with a stale price: rejected; with a fresh one after maturity: allowed.
    let deadline = f.h.loan(&f.loan).deadline_slot;
    f.h.svm.warp_to_slot(deadline + f.h.profile.market.max_price_age_slots + 2);
    let anyone = Keypair::new();
    f.h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    let err = f.h.seize(&f.setup, &f.loan, &anyone).unwrap_err();
    assert!(err.has_code("PriceStale"), "{err}");
    f.h.post_price(&f.setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    f.h.seize(&f.setup, &f.loan, &anyone).unwrap();
    assert_eq!(f.h.loan(&f.loan).status, LoanStatus::Defaulted as u8);
}

#[test]
fn price_cannot_regress() {
    let mut f = matched_loan(200_000 * USDC);
    let admin = f.h.admin.insecure_clone();
    let ix = anchor_ix_post_price(&f, 1, -8, 0);
    let err = f.h.send(&admin, &[ix], &[]).unwrap_err();
    assert!(err.has_code("PriceRegressed"), "{err}");
}

fn anchor_ix_post_price(
    f: &crate::credit_fixture::Fixture,
    price: u64,
    expo: i32,
    publish_time: i64,
) -> solana_instruction::Instruction {
    use anchor_lang::{InstructionData, ToAccountMetas};
    solana_instruction::Instruction {
        program_id: window_credit::ID,
        accounts: window_credit::accounts::PostPrice {
            keeper: f.h.admin.pubkey(),
            config: f.setup.credit_config,
            price_cache: f.setup.price_cache,
            system_program: solana_system_interface::program::ID,
        }
        .to_account_metas(None),
        data: window_credit::instruction::PostPrice { price, expo, publish_time }.data(),
    }
}
