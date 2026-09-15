use solana_zk_sdk::{
    encryption::{grouped_elgamal::GroupedElGamalCiphertext, pedersen::Pedersen},
    zk_elgamal_proof_program::proof_data::{
        BatchedRangeProofU64Data, GroupedCiphertext2HandlesValidityProofData,
    },
};
use window_clearing::Side;
use window_elgamal::{encrypt, keys};
use window_proofs::bid;
use window_testkit::Harness;

use crate::USDC;

fn fresh() -> (Harness, usize) {
    let mut h = Harness::new("demo");
    let m = h.add_member();
    h.open_epoch();
    (h, m)
}

#[test]
fn range_proof_over_a_different_commitment_is_rejected() {
    let (mut h, m) = fresh();
    let good =
        bid::build(&h.members[m].elgamal, &h.auditor.pubkey_bytes(), 100 * USDC, USDC).unwrap();
    // A valid 40-bit range proof, but over some other commitment (a "size" the ciphertext does not carry).
    let (other_c, other_o) = Pedersen::new(5u64);
    let (pad, pad_o) = Pedersen::new(0u64);
    let range = BatchedRangeProofU64Data::new(
        vec![&other_c, &pad],
        vec![5, 0],
        vec![40, 24],
        vec![&other_o, &pad_o],
    )
    .unwrap();
    let err = h.submit_bid_with(m, Side::Bid, 5, &good.validity, &range).unwrap_err();
    assert!(err.has_code("RangeCommitmentMismatch"), "{err}");
}

#[test]
fn range_proof_with_the_wrong_bit_length_is_rejected() {
    let (mut h, m) = fresh();
    let member = &h.members[m].elgamal;
    let opening = encrypt::Opening::random();
    let size = 100 * USDC;
    let ct =
        encrypt::grouped2_with(&member.pubkey_bytes(), &h.auditor.pubkey_bytes(), size, &opening)
            .unwrap();
    let sdk_ct = GroupedElGamalCiphertext::<2>::from_bytes(&ct.to_bytes()).unwrap();
    let auditor_pk = keys::pubkey_from_bytes(&h.auditor.pubkey_bytes()).unwrap();
    let validity = GroupedCiphertext2HandlesValidityProofData::new(
        member.pubkey(),
        &auditor_pk,
        &sdk_ct,
        size,
        &opening.0,
    )
    .unwrap();
    // Correct commitment, but only 32 bits proven with 32 bits of padding: a 2^32.. size could hide.
    let shifted = Pedersen::with(size - USDC, &opening.0);
    let (pad, pad_o) = Pedersen::new(0u64);
    let range = BatchedRangeProofU64Data::new(
        vec![&shifted, &pad],
        vec![size - USDC, 0],
        vec![32, 32],
        vec![&opening.0, &pad_o],
    )
    .unwrap();
    let err = h.submit_bid_with(m, Side::Bid, 5, &validity, &range).unwrap_err();
    assert!(err.has_code("RangeBitLength"), "{err}");
}

#[test]
fn ciphertext_under_someone_elses_key_is_rejected() {
    let (mut h, m) = fresh();
    let impostor = keys::Keypair::random();
    let proofs = bid::build(&impostor, &h.auditor.pubkey_bytes(), 100 * USDC, USDC).unwrap();
    let err = h.submit_bid_with(m, Side::Bid, 5, &proofs.validity, &proofs.range).unwrap_err();
    assert!(err.has_code("MemberKeyMismatch"), "{err}");
}

#[test]
fn ciphertext_without_the_auditor_handle_is_rejected() {
    let (mut h, m) = fresh();
    let fake_auditor = keys::Keypair::random();
    let proofs =
        bid::build(&h.members[m].elgamal, &fake_auditor.pubkey_bytes(), 100 * USDC, USDC).unwrap();
    let err = h.submit_bid_with(m, Side::Bid, 5, &proofs.validity, &proofs.range).unwrap_err();
    assert!(err.has_code("AuditorKeyMismatch"), "{err}");
}

#[test]
fn dust_and_oversized_bids_cannot_even_be_proven() {
    let (h, m) = fresh();
    let k = &h.members[m].elgamal;
    assert!(bid::build(k, &h.auditor.pubkey_bytes(), USDC - 1, USDC).is_err(), "below s_min");
    assert!(
        bid::build(k, &h.auditor.pubkey_bytes(), USDC + (1 << 40), USDC).is_err(),
        "≥ 2^40 above s_min"
    );
}

#[test]
fn one_bid_per_member_side_tick_epoch() {
    let (mut h, m) = fresh();
    h.submit_bid(m, Side::Bid, 5, 10 * USDC).unwrap();
    let err = h.submit_bid(m, Side::Bid, 5, 10 * USDC).unwrap_err();
    assert!(err.error.contains("AccountAlreadyInUse") || err.has_code("already in use"), "{err}");
    h.submit_bid(m, Side::Bid, 6, 10 * USDC).unwrap();
    h.submit_bid(m, Side::Ask, 5, 10 * USDC).unwrap();
}
