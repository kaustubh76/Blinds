//! Spec v2 §16 Phase 3 gate: wrap → bid → print → match → priced lock → deposit → confirm → fund
//! → repay → release → unwrap, and the seize branch. Real Token-2022 confidential transfers.
use solana_keypair::Keypair;
use solana_signer::Signer;
use window_clearing::Side;
use window_credit::state::LoanStatus;
use window_testkit::Harness;

const USDC: u64 = 1_000_000;
const MILLI_SHARE: u64 = 1; // amounts below are in milli-shares
const PRICE_TSLA: (u64, i32) = (40_012_000_000, -8); // $400.12

struct World {
    h: Harness,
    setup: window_testkit::credit::CreditSetup,
    borrower: usize,
    lender: usize,
    borrower_tokens: window_testkit::credit::MemberTokens,
    lender_tokens: window_testkit::credit::MemberTokens,
}

/// Wrap 2,000.000 shares for the borrower, run one epoch with bid 200k @ 10 vs ask 300k @ 5, print, match.
fn matched_loan() -> (World, solana_pubkey::Pubkey, window_proofs::bid::BidProofs, u64) {
    let mut h = Harness::new("demo");
    let setup = h.with_credit();
    let borrower = h.add_member();
    let lender = h.add_member();
    let mut borrower_tokens = h.onboard_tokens(&setup, borrower, 5_000_000 * MILLI_SHARE);
    let lender_tokens = h.onboard_tokens(&setup, lender, 0);
    h.wrap(&setup, borrower, &mut borrower_tokens, 2_000_000).unwrap();
    assert!(
        h.available_matches(&borrower_tokens.cstock),
        "confidential balance = 2,000.000 shares"
    );
    assert_eq!(h.mint_supply(&setup.cstock_mint), 2_000_000);
    assert_eq!(h.token_balance(&setup.custody), 2_000_000);

    let epoch = h.open_epoch();
    let loan_size = 200_000 * USDC;
    let (_, bid) = h.submit_bid_keep(borrower, Side::Bid, 10, loan_size).unwrap();
    h.submit_bid(lender, Side::Ask, 5, 300_000 * USDC).unwrap();
    h.close_epoch(epoch);
    let out = h.print_epoch(epoch).unwrap();
    assert_eq!((out.r_star_tick, out.matched), (Some(5), loan_size));
    let loan = h.post_match_full(&setup, epoch, borrower, 10, lender, 5, 0).unwrap();
    let l = h.loan(&loan);
    assert_eq!(l.status, LoanStatus::Pending as u8);
    assert_eq!(l.size_ct, bid.ciphertext.to_bytes(), "full fill copies the bid ciphertext");
    assert_eq!(
        (l.tick, l.bid_tick, l.fill_num, l.fill_den),
        (5, 10, 200_000 * USDC, 300_000 * USDC),
        "the lone ask is the marginal tick: disclosed pro-rata fill"
    );
    (World { h, setup, borrower, lender, borrower_tokens, lender_tokens }, loan, bid, loan_size)
}

#[test]
fn borrow_lock_fund_repay_release_unwrap() {
    let (mut w, loan, bid, loan_size) = matched_loan();
    let World { h, setup, borrower, borrower_tokens, .. } = &mut w;
    h.post_price(setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    let scalars = h.current_scalars(setup, 1.0);
    assert_eq!((scalars.k_c, scalars.k_l), (40_012_000, 150));

    // 1,000.000 shares × $400.12 = 400,120 USDC ≥ 150% × 200,000.
    let pledge = 1_000_000;
    let (claim, pair) = h
        .build_lock_proofs(*borrower, &h.loan(&loan), pledge, loan_size, &bid.opening, &scalars)
        .unwrap();
    let stats = h.lock_collateral(setup, *borrower, &loan, &claim, &pair).unwrap();
    eprintln!("lock_collateral: {} CU, {} B", stats.compute_units, stats.bytes);
    let l = h.loan(&loan);
    assert_eq!(l.status, LoanStatus::Requested as u8);
    assert_eq!((l.k_c, l.k_l, l.price_at_lock, l.mult_at_lock), (40_012_000, 150, 40_012, 1_000));
    assert_eq!(l.collateral_ct, claim.ciphertext.to_bytes());
    assert_eq!(l.delta_commitment, pair.delta_commitment.0);

    // Deposit: a real confidential transfer into escrow, introspected by the program.
    let stats = h.deposit_collateral(setup, *borrower, borrower_tokens, &loan, pledge).unwrap();
    eprintln!(
        "confidential transfer + deposit_collateral: {} CU, {} B",
        stats.compute_units, stats.bytes
    );
    assert_eq!(h.loan(&loan).status, LoanStatus::Deposited as u8);
    assert_eq!(borrower_tokens.cstock.available, 1_000_000);
    assert!(h.available_matches(&borrower_tokens.cstock));

    // Operator confirms; administrator attests funding; deadline set.
    h.confirm_lock(setup, &loan).unwrap();
    assert_eq!(h.loan(&loan).status, LoanStatus::Locked as u8);
    h.confirm_funding(setup, &loan).unwrap();
    let l = h.loan(&loan);
    assert_eq!(l.status, LoanStatus::Active as u8);
    assert_eq!(l.deadline_slot, l.funded_slot + h.profile.market.tenor_slots);

    // Cannot seize before maturity.
    let anyone = Keypair::new();
    h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    assert!(h.seize(setup, &loan, &anyone).unwrap_err().has_code("NotMatured"));

    // Repay; operator returns the collateral (escrow applies its pending balance first).
    h.repay(setup, &loan).unwrap();
    assert_eq!(h.loan(&loan).status, LoanStatus::Repaid as u8);
    let op = setup.operator.insecure_clone();
    let mut escrow = std::mem::replace(
        &mut setup.escrow,
        h.create_confidential_account(&setup.cstock_mint, &op),
    );
    h.apply_pending_balance(&mut escrow, &op, pledge).unwrap();
    setup.escrow = escrow;
    let dest = borrower_tokens.cstock.address;
    h.release_collateral(setup, &loan, &dest, pledge).unwrap();
    assert!(h.loan(&loan).collateral_released);
    assert!(h.release_collateral(setup, &loan, &dest, 0).is_err(), "released once");
    let wallet = h.members[*borrower].wallet.insecure_clone();
    h.apply_pending_balance(&mut borrower_tokens.cstock, &wallet, pledge).unwrap();
    assert_eq!(borrower_tokens.cstock.available, 2_000_000);
    assert!(h.available_matches(&borrower_tokens.cstock));

    // Unwrap 500.000 shares: confidential withdraw → burn → custody release. Invariant holds.
    h.confidential_withdraw(
        &mut borrower_tokens.cstock,
        &wallet,
        &setup.cstock_mint,
        setup.decimals,
        500_000,
    )
    .unwrap();
    assert_eq!(h.token_balance(&borrower_tokens.cstock.address), 500_000);
    h.unwrap(setup, *borrower, borrower_tokens, 500_000).unwrap();
    assert_eq!(h.mint_supply(&setup.cstock_mint), 1_500_000);
    assert_eq!(h.token_balance(&setup.custody), 1_500_000);
    assert_eq!(h.token_balance(&borrower_tokens.mock), 3_500_000);
}

#[test]
fn default_is_seized_permissionlessly_with_a_fresh_price_and_forwarded_to_the_lender() {
    let (mut w, loan, bid, loan_size) = matched_loan();
    let World { h, setup, borrower, lender, borrower_tokens, lender_tokens } = &mut w;
    h.post_price(setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    let scalars = h.current_scalars(setup, 1.0);
    let pledge = 1_000_000;
    let (claim, pair) = h
        .build_lock_proofs(*borrower, &h.loan(&loan), pledge, loan_size, &bid.opening, &scalars)
        .unwrap();
    h.lock_collateral(setup, *borrower, &loan, &claim, &pair).unwrap();
    h.deposit_collateral(setup, *borrower, borrower_tokens, &loan, pledge).unwrap();
    h.confirm_lock(setup, &loan).unwrap();
    h.confirm_funding(setup, &loan).unwrap();
    let deadline = h.loan(&loan).deadline_slot;

    let anyone = Keypair::new();
    h.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    // Past the deadline but with a stale price: inaction, never wrong action.
    h.svm.warp_to_slot(deadline + 1 + h.profile.market.max_price_age_slots);
    assert!(h.seize(setup, &loan, &anyone).unwrap_err().has_code("PriceStale"));
    h.post_price(setup, PRICE_TSLA.0, PRICE_TSLA.1).unwrap();
    h.seize(setup, &loan, &anyone).unwrap();
    assert_eq!(h.loan(&loan).status, LoanStatus::Defaulted as u8);
    assert!(h.seize(setup, &loan, &anyone).unwrap_err().has_code("NotActive"));

    // Collateral goes to the lender, not the borrower.
    let op = setup.operator.insecure_clone();
    let mut escrow = std::mem::replace(
        &mut setup.escrow,
        h.create_confidential_account(&setup.cstock_mint, &op),
    );
    h.apply_pending_balance(&mut escrow, &op, pledge).unwrap();
    setup.escrow = escrow;
    let wrong = borrower_tokens.cstock.address;
    let err = h.release_collateral(setup, &loan, &wrong, pledge).unwrap_err();
    assert!(err.has_code("WrongDestination"), "{err}");
    // the failed attempt moved escrow's tracked balance; restore it for the real release
    setup.escrow.available += pledge;
    let dest = lender_tokens.cstock.address;
    h.release_collateral(setup, &loan, &dest, pledge).unwrap();
    let lw = h.members[*lender].wallet.insecure_clone();
    h.apply_pending_balance(&mut lender_tokens.cstock, &lw, pledge).unwrap();
    assert!(h.available_matches(&lender_tokens.cstock));
    assert_eq!(lender_tokens.cstock.available, pledge);
}
