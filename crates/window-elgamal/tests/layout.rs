//! Byte layouts must equal solana-zk-sdk's, and the host path must agree with dalek.
use curve25519_dalek::{constants::RISTRETTO_BASEPOINT_POINT, scalar::Scalar};
use proptest::prelude::*;
use solana_zk_sdk::encryption::{
    elgamal::{ElGamalCiphertext, ElGamalKeypair},
    grouped_elgamal::GroupedElGamal,
};
use window_elgamal::{
    decrypt, encrypt, keys::Keypair, solvency_delta, Ciphertext, GroupedCiphertext2, Point,
    BASEPOINT,
};

#[test]
fn basepoint_constant_is_dalek_basepoint() {
    assert_eq!(BASEPOINT.0, curve25519_dalek::constants::RISTRETTO_BASEPOINT_COMPRESSED.to_bytes());
    assert!(BASEPOINT.is_valid());
    assert!(Point::default().is_identity());
}

#[test]
fn elgamal_layout_matches_sdk() {
    let kp = ElGamalKeypair::new_rand();
    let sdk = kp.pubkey().encrypt(1234u64);
    let ours = Ciphertext::from_bytes(&sdk.to_bytes());
    assert_eq!(ours.to_bytes(), sdk.to_bytes());
    assert_eq!(ours.commitment.0, sdk.commitment.to_bytes());
    assert_eq!(ours.handle.0, sdk.handle.to_bytes());
}

#[test]
fn grouped_layout_matches_sdk_and_handle_order() {
    let member = ElGamalKeypair::new_rand();
    let auditor = ElGamalKeypair::new_rand();
    let sdk = GroupedElGamal::<2>::encrypt([member.pubkey(), auditor.pubkey()], 77u64);
    let bytes: [u8; 96] = sdk.to_bytes().try_into().unwrap();
    let ours = GroupedCiphertext2::from_bytes(&bytes);
    assert_eq!(ours.to_bytes(), bytes);
    let ct = ours.to_ciphertext(1).unwrap();
    let auditor_kp = Keypair(auditor);
    assert!(decrypt::equals(&auditor_kp, &ct, 77));
    assert!(!decrypt::equals(&auditor_kp, &ct, 78));
}

#[test]
fn accumulation_is_homomorphic_and_residual_encrypts_zero() {
    let member = Keypair::random();
    let auditor = Keypair::random();
    let (a, _) =
        encrypt::grouped2(&member.pubkey_bytes(), &auditor.pubkey_bytes(), 1_000_000_000).unwrap();
    let (b, _) =
        encrypt::grouped2(&member.pubkey_bytes(), &auditor.pubkey_bytes(), 250_000_000).unwrap();
    let acc = Ciphertext::ZERO.accumulate(&a, 1).unwrap().accumulate(&b, 1).unwrap();
    assert!(decrypt::equals(&auditor, &acc, 1_250_000_000));
    let residual = acc.residual(1_250_000_000).unwrap();
    assert!(decrypt::equals(&auditor, &residual, 0), "residual of the true sum encrypts zero");
    assert!(!decrypt::equals(&auditor, &acc.residual(1_250_000_001).unwrap(), 0));
    assert!(!decrypt::equals(&member, &acc, 1_250_000_000), "member key cannot read the aggregate");
}

#[test]
fn solvency_delta_matches_direct_dalek_computation() {
    let borrower = Keypair::random();
    let (c, l) = (1_000_000u64, 200_000_000_000u64);
    let (k_c, k_l) = (40_012_000u64, 150u64);
    let ec_sdk: ElGamalCiphertext = borrower.pubkey().encrypt(c);
    let el_sdk: ElGamalCiphertext = borrower.pubkey().encrypt(l);
    let ec = Ciphertext::from_bytes(&ec_sdk.to_bytes());
    let el = Ciphertext::from_bytes(&el_sdk.to_bytes());
    let delta = solvency_delta(&ec, k_c, &el, k_l).unwrap();
    #[allow(clippy::op_ref)] // the SDK implements the operators on references
    let expected = &(&ec_sdk * &Scalar::from(k_c)) - &(&el_sdk * &Scalar::from(k_l));
    assert_eq!(delta.to_bytes(), expected.to_bytes());
    assert!(decrypt::equals(&borrower, &delta, k_c * c - k_l * l));
}

proptest! {
    #[test]
    fn scalar_mul_agrees_with_dalek(v in any::<u64>()) {
        let ours = Point::from_amount(v).unwrap();
        let theirs = (RISTRETTO_BASEPOINT_POINT * Scalar::from(v)).compress().to_bytes();
        prop_assert_eq!(ours.0, theirs);
    }
}
