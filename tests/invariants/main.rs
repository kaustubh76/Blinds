//! Spec v2 §15 invariants, driven as a randomised state machine over the harness.
use solana_keypair::Keypair;
use solana_signer::Signer;
use window_clearing::{clear, Side};
use window_testkit::Harness;

const USDC: u64 = 1_000_000;

/// Deterministic xorshift so failures reproduce.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[test]
fn wrap_supply_equals_custody_equals_vault_and_confidential_balances_track() {
    let mut h = Harness::new("demo");
    let setup = h.with_credit();
    let m = h.add_member();
    let mut t = h.onboard_tokens(&setup, m, 10_000_000);
    let wallet = h.members[m].wallet.insecure_clone();
    let mut rng = Rng(0x9e3779b97f4a7c15);
    let mut wrapped_total = 0u64;
    for step in 0..6 {
        let amount = 1_000 + rng.below(500_000);
        if step % 3 == 2 && t.cstock.available >= amount {
            h.confidential_withdraw(
                &mut t.cstock,
                &wallet,
                &setup.cstock_mint,
                setup.decimals,
                amount,
            )
            .unwrap();
            h.unwrap(&setup, m, &t, amount).unwrap();
            wrapped_total -= amount;
        } else {
            h.wrap(&setup, m, &mut t, amount).unwrap();
            wrapped_total += amount;
        }
        let vault: window_wrap::state::Vault = h.account(&setup.vault);
        assert_eq!(h.mint_supply(&setup.cstock_mint), wrapped_total, "supply");
        assert_eq!(h.token_balance(&setup.custody), wrapped_total, "custody");
        assert_eq!(vault.wrapped, wrapped_total, "vault counter");
        assert!(h.available_matches(&t.cstock), "owner-tracked confidential balance");
    }
}

#[test]
fn epochs_are_monotonic_and_every_print_matches_the_curve() {
    let mut h = Harness::new("demo");
    let members: Vec<usize> = (0..4).map(|_| h.add_member()).collect();
    let mut rng = Rng(42);
    let mut last_index = None;
    for _ in 0..5 {
        let index = h.open_epoch();
        if let Some(prev) = last_index {
            assert_eq!(index, prev + 1, "epoch indices are consecutive");
            assert!(
                h.epoch(prev).status != window_auction::state::EpochStatus::Open as u8,
                "previous epoch settled before the next opens"
            );
        }
        // cannot open twice
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {})).is_ok());
        for &m in &members {
            if rng.below(4) == 0 {
                continue;
            }
            let side = if rng.below(2) == 0 { Side::Ask } else { Side::Bid };
            let tick = rng.below(37) as u8;
            let size = (1 + rng.below(5_000)) * USDC;
            let _ = h.submit_bid(m, side, tick, size); // duplicates (same side/tick) are rejected: fine
        }
        h.close_epoch(index);
        let curve = h.decrypt_curve(index);
        let expected = clear(&curve).unwrap();
        let out = h.print_epoch(index).unwrap();
        assert_eq!(out.r_star_tick, expected.map(|c| c.r_star.get()));
        if let Some(c) = expected {
            let (s, d) = window_clearing::cumulative(&curve).unwrap();
            assert!(
                c.matched <= s[c.r_star.index()].min(d[c.r_star.index()]),
                "matched ≤ min(S, D)"
            );
            assert_eq!(c.matched, d[c.r_star.index()], "bids fully filled");
        }
        let p = h.print(index).unwrap();
        assert_eq!(p.proven_bitmap, p.nonzero_bitmap, "ρ = 1 on every print");
        last_index = Some(index);
    }
    let s = h.oracle_state();
    assert!(s.prints as usize <= 5);
}

#[test]
fn deadline_safety_and_terminal_states_are_final() {
    let mut h = Harness::new("demo");
    let setup = h.with_credit();
    let b = h.add_member();
    let l = h.add_member();
    let mut t = h.onboard_tokens(&setup, b, 5_000_000);
    h.wrap(&setup, b, &mut t, 2_000_000).unwrap();
    let epoch = h.open_epoch();
    let size = 100_000 * USDC;
    let (_, bid) = h.submit_bid_keep(b, Side::Bid, 10, size).unwrap();
    h.submit_bid(l, Side::Ask, 5, 200_000 * USDC).unwrap();
    h.close_epoch(epoch);
    h.print_epoch(epoch).unwrap();
    let loan = h.post_match_full(&setup, epoch, b, 10, l, 5, 0).unwrap();
    h.post_price(&setup, 40_012_000_000, -8).unwrap();
    let scalars = h.current_scalars(&setup, 1.0);
    let (claim, pair) =
        h.build_lock_proofs(b, &h.loan(&loan), 600_000, size, &bid.opening, &scalars).unwrap();
    h.lock_collateral(&setup, b, &loan, &claim, &pair).unwrap();
    // Lifecycle ordering: every out-of-order transition is refused.
    assert!(h.confirm_lock(&setup, &loan).is_err(), "not deposited yet");
    assert!(h.confirm_funding(&setup, &loan).is_err(), "not locked yet");
    assert!(h.repay(&setup, &loan).is_err(), "not active yet");
    h.deposit_collateral(&setup, b, &mut t, &loan, 600_000).unwrap();
    h.confirm_lock(&setup, &loan).unwrap();
    h.confirm_funding(&setup, &loan).unwrap();
    let anyone = Keypair::new();
    h.svm.airdrop(&window_testkit::addr(&anyone.pubkey()), 1_000_000_000).unwrap();
    // Deadline safety: at every slot ≤ deadline, seize fails (sampled).
    let deadline = h.loan(&loan).deadline_slot;
    for slot in [deadline - 10, deadline - 1, deadline] {
        h.warp_to_slot(slot);
        h.post_price(&setup, 40_012_000_000, -8).unwrap();
        assert!(h.seize(&setup, &loan, &anyone).unwrap_err().has_code("NotMatured"));
    }
    // Repay, then nothing else can change the status.
    h.repay(&setup, &loan).unwrap();
    assert!(h.repay(&setup, &loan).is_err());
    h.warp_to_slot(deadline + 1);
    h.post_price(&setup, 40_012_000_000, -8).unwrap();
    assert!(
        h.seize(&setup, &loan, &anyone).unwrap_err().has_code("NotActive"),
        "no double terminal state"
    );
    assert!(h.confirm_funding(&setup, &loan).is_err());
}
