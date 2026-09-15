use proptest::prelude::*;
use solana_zk_sdk::encryption::elgamal::ElGamalCiphertext;
use window_elgamal::{bsgs::Solver, encrypt, keys::Keypair, Ciphertext, Point};

fn solver() -> &'static Solver {
    use std::sync::OnceLock;
    static S: OnceLock<Solver> = OnceLock::new();
    S.get_or_init(|| Solver::build(16))
}

#[test]
fn solves_small_and_boundary_values() {
    let s = solver();
    for v in [0u64, 1, 2, 65_535, 65_536, 1_000_000, (1 << 20) - 1, 1 << 20, 123_456_789] {
        assert_eq!(s.solve(&Point::from_amount(v).unwrap(), 1 << 28), Some(v), "v={v}");
    }
    assert_eq!(s.solve(&Point::from_amount(5).unwrap(), 4), None, "above max_value");
}

#[test]
fn decrypts_an_aggregate_under_the_auditor_key() {
    let s = solver();
    let member = Keypair::random();
    let auditor = Keypair::random();
    let sizes = [1_000_000u64, 250_000, 4_000_000];
    let mut acc = Ciphertext::ZERO;
    for size in sizes {
        let (ct, _) =
            encrypt::grouped2(&member.pubkey_bytes(), &auditor.pubkey_bytes(), size).unwrap();
        acc = acc.accumulate(&ct, 1).unwrap();
    }
    assert_eq!(s.decrypt(&auditor, &acc, 3 << 40), Some(sizes.iter().sum()));
}

#[test]
fn agrees_with_sdk_decode_u32_below_2_32() {
    let s = solver();
    let auditor = Keypair::random();
    for v in [0u64, 42, 999_999_999, u32::MAX as u64 - 1] {
        let sdk: ElGamalCiphertext = auditor.pubkey().encrypt(v);
        let ours = Ciphertext::from_bytes(&sdk.to_bytes());
        assert_eq!(s.decrypt(&auditor, &ours, 1 << 32), auditor.secret().decrypt_u32(&sdk));
        assert_eq!(s.decrypt(&auditor, &ours, 1 << 32), Some(v));
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]
    #[test]
    fn random_values_up_to_2_28(v in 0u64..(1 << 28)) {
        prop_assert_eq!(solver().solve(&Point::from_amount(v).unwrap(), 1 << 28), Some(v));
    }
}

/// Worst case near the spec bound with a production-size table; seconds, so opt-in.
#[test]
#[ignore]
fn worst_case_near_2_44_with_22_bit_table() {
    let s = Solver::build(22);
    let v = (1u64 << 44) - 12_345;
    let t = std::time::Instant::now();
    assert_eq!(s.solve(&Point::from_amount(v).unwrap(), 1 << 44), Some(v));
    eprintln!("bsgs worst case 2^44: {:?}", t.elapsed());
}
