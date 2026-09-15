use solana_zk_elgamal_proof_interface::proof_data::ZkProofData;
use solana_zk_sdk::zk_elgamal_proof_program::VerifyZkProof;
use window_clearing::TICKS;
use window_elgamal::{decrypt, keys::Keypair, shifted_commitment, Ciphertext, Point};
use window_proofs::{
    bid, pocd,
    scalar::{solvency_scalars, SolvencyScalars},
    solvency::{self, SolvencyInputs},
    verify::{self, EpochView, LoanView, PrintView},
    ProofError,
};

const S_MIN: u64 = 1_000_000;

#[test]
fn bid_proofs_verify_and_bind_to_the_shifted_commitment() {
    let member = Keypair::random();
    let auditor = Keypair::random();
    let b = bid::build(&member, &auditor.pubkey_bytes(), 5_000_000_000, S_MIN).unwrap();
    assert!(b.validity.verify_proof().is_ok());
    assert!(b.range.verify_proof().is_ok());
    let v = b.validity.context_data();
    assert_eq!(bytemuck::bytes_of(&v.first_pubkey), member.pubkey_bytes());
    assert_eq!(bytemuck::bytes_of(&v.second_pubkey), auditor.pubkey_bytes());
    assert_eq!(bytemuck::bytes_of(&v.grouped_ciphertext), b.ciphertext.to_bytes());
    // The program's check: range.commitments[0] == C − s_min·G, 40 bits.
    let r = b.range.context_data();
    assert_eq!(
        bytemuck::bytes_of(&r.commitments[0]),
        shifted_commitment(&b.ciphertext.commitment, S_MIN).unwrap().0
    );
    assert_eq!(r.bit_lengths[0], 40);
    // Below the minimum or above the range: unbuildable.
    assert!(matches!(
        bid::build(&member, &auditor.pubkey_bytes(), S_MIN - 1, S_MIN),
        Err(ProofError::AmountRange)
    ));
    assert!(matches!(
        bid::build(&member, &auditor.pubkey_bytes(), S_MIN + (1 << 40), S_MIN),
        Err(ProofError::AmountRange)
    ));
}

#[test]
fn pocd_binds_to_accumulator_and_sum() {
    let auditor = Keypair::random();
    let alice = Keypair::random();
    let a = bid::build(&alice, &auditor.pubkey_bytes(), 2_000_000, S_MIN).unwrap();
    let b = bid::build(&alice, &auditor.pubkey_bytes(), 3_000_000, S_MIN).unwrap();
    let acc = Ciphertext::ZERO
        .accumulate(&a.ciphertext, 1)
        .unwrap()
        .accumulate(&b.ciphertext, 1)
        .unwrap();
    let good = pocd::build(&auditor, &acc, 5_000_000).unwrap();
    assert!(good.verify_proof().is_ok());
    assert_eq!(
        bytemuck::bytes_of(&good.context_data().ciphertext),
        acc.residual(5_000_000).unwrap().to_bytes()
    );
    // zk-sdk >= 5 refuses to build a proof for a false statement.
    assert!(pocd::build(&auditor, &acc, 5_000_001).is_err(), "no PoCD exists for a false sum");
}

#[test]
fn print_verifier_accepts_a_correct_print_and_rejects_tampering() {
    let auditor = Keypair::random();
    let alice = Keypair::random();
    let mut epoch = EpochView {
        auditor_pubkey: auditor.pubkey_bytes(),
        acc: [[Ciphertext::ZERO; TICKS]; 2],
        bid_count: [[0; TICKS]; 2],
    };
    // ask 500 USDC @ tick 8, bid 400 USDC @ tick 16
    let ask = bid::build(&alice, &auditor.pubkey_bytes(), 500_000_000, S_MIN).unwrap();
    let bidp = bid::build(&alice, &auditor.pubkey_bytes(), 400_000_000, S_MIN).unwrap();
    epoch.acc[0][8] = Ciphertext::ZERO.accumulate(&ask.ciphertext, 1).unwrap();
    epoch.bid_count[0][8] = 1;
    epoch.acc[1][16] = Ciphertext::ZERO.accumulate(&bidp.ciphertext, 1).unwrap();
    epoch.bid_count[1][16] = 1;
    let mut print =
        PrintView { claimed_sum: [[0; TICKS]; 2], r_star_tick: Some(8), matched: 400_000_000 };
    print.claimed_sum[0][8] = 500_000_000;
    print.claimed_sum[1][16] = 400_000_000;
    let proofs = vec![
        pocd::build(&auditor, &epoch.acc[0][8], 500_000_000).unwrap(),
        pocd::build(&auditor, &epoch.acc[1][16], 400_000_000).unwrap(),
    ];
    let v = verify::print(&epoch, &print, &proofs);
    assert!(v.ok, "{:?}", v.failures);
    assert_eq!((v.nonzero, v.proven, v.r_star_recomputed), (2, 2, Some(8)));

    // wrong rate
    let mut p2 = PrintView { r_star_tick: Some(9), ..print_clone(&print) };
    p2.matched = 400_000_000;
    assert!(!verify::print(&epoch, &p2, &proofs).ok);
    // false sum with the proof for the true sum: binding fails
    let mut p3 = print_clone(&print);
    p3.claimed_sum[0][8] = 500_000_001;
    let v3 = verify::print(&epoch, &p3, &proofs);
    assert!(!v3.ok && v3.proven == 1);
    // missing proof
    let v4 = verify::print(&epoch, &print, &proofs[..1]);
    assert!(!v4.ok && v4.proven == 1);
}

fn print_clone(p: &PrintView) -> PrintView {
    PrintView { claimed_sum: p.claimed_sum, r_star_tick: p.r_star_tick, matched: p.matched }
}

#[test]
fn solvency_pair_verifies_and_undercollateralized_is_unbuildable() {
    let borrower = Keypair::random();
    let auditor = Keypair::random();
    let s: SolvencyScalars = solvency_scalars(40_012, 1_000, 15_000).unwrap();
    let coll = solvency::build_collateral(&borrower, &auditor.pubkey_bytes(), 1_000_000).unwrap(); // 1,000.000 shares
    assert!(coll.validity.verify_proof().is_ok() && coll.range.verify_proof().is_ok());
    assert_eq!(coll.range.context_data().bit_lengths[0], 32);
    let loan = bid::build(&borrower, &auditor.pubkey_bytes(), 200_000_000_000, S_MIN).unwrap(); // 200,000 USDC
    let ec = coll.ciphertext.to_ciphertext(0).unwrap();
    let el = loan.ciphertext.to_ciphertext(0).unwrap();
    let inputs = SolvencyInputs {
        collateral: &ec,
        c: 1_000_000,
        c_opening: &coll.opening,
        loan: &el,
        l: 200_000_000_000,
        l_opening: &loan.opening,
    };
    let sp = solvency::build(&borrower, &inputs, &s).unwrap();
    assert!(sp.equality.verify_proof().is_ok() && sp.range.verify_proof().is_ok());
    let lv = LoanView {
        borrower_pubkey: borrower.pubkey_bytes(),
        size_ct: loan.ciphertext,
        collateral_ct: coll.ciphertext,
        delta_commitment: sp.delta_commitment,
        k_c: s.k_c,
        k_l: s.k_l,
    };
    verify::solvency(&lv, &sp.equality, &sp.range).unwrap();
    // The borrower can check its own delta without BSGS.
    let e_delta = window_elgamal::solvency_delta(&ec, s.k_c, &el, s.k_l).unwrap();
    assert!(decrypt::equals(&borrower, &e_delta, s.k_c * 1_000_000 - s.k_l * 200_000_000_000));

    // 300,000 USDC: unbuildable
    let big = bid::build(&borrower, &auditor.pubkey_bytes(), 300_000_000_000, S_MIN).unwrap();
    let elb = big.ciphertext.to_ciphertext(0).unwrap();
    let bad = SolvencyInputs {
        collateral: &ec,
        c: 1_000_000,
        c_opening: &coll.opening,
        loan: &elb,
        l: 300_000_000_000,
        l_opening: &big.opening,
    };
    assert!(matches!(solvency::build(&borrower, &bad, &s), Err(ProofError::Undercollateralized)));

    // Tampered scalars on the loan view: verifier rejects (E_delta differs).
    let lv_t = LoanView {
        k_c: s.k_c + 1,
        ..LoanView {
            borrower_pubkey: borrower.pubkey_bytes(),
            size_ct: loan.ciphertext,
            collateral_ct: coll.ciphertext,
            delta_commitment: sp.delta_commitment,
            k_c: s.k_c,
            k_l: s.k_l,
        }
    };
    assert!(verify::solvency(&lv_t, &sp.equality, &sp.range).is_err());
    let _ = Point::default();
}
