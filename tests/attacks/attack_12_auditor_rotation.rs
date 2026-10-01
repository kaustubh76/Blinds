//! Rotating the auditor key is admin-only, refuses a zero key, and — the property that matters —
//! cannot happen while an epoch is open.
//!
//! The auditor key is the one that decrypts every aggregate a print proves. An epoch records the key
//! it was opened under (`Epoch.auditor_pubkey`), and every bid in it is encrypted to that key, so a
//! rotation mid-window would leave bids sealed to a key the print no longer claims — aggregates that
//! can never be proven, or worse, a print whose proofs are checked against a key the bidders never
//! used. `rotate_auditor` refuses while `has_open_epoch`, and nothing tested that until now.

use solana_keypair::Keypair;
use solana_signer::Signer;
use window_testkit::Harness;

const NEW_KEY: [u8; 32] = [7u8; 32];

#[test]
fn only_the_admin_rotates_the_auditor_and_never_to_a_zero_key() {
    let mut h = Harness::new("demo");
    let before = h.auction_config().auditor_elgamal_pubkey;

    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let err = h.rotate_auditor(&stranger, NEW_KEY).unwrap_err();
    assert!(err.has_code("Unauthorized"), "a stranger rotated the auditor key: {err}");

    // A zero key would make every handle decrypt to nothing; the program refuses it outright.
    let admin = h.admin.insecure_clone();
    let err = h.rotate_auditor(&admin, [0u8; 32]).unwrap_err();
    assert!(err.has_code("BadParams"), "the all-zero key was accepted: {err}");

    assert_eq!(
        h.auction_config().auditor_elgamal_pubkey,
        before,
        "the key moved on a refused call"
    );
}

#[test]
fn the_auditor_cannot_be_rotated_out_from_under_an_open_epoch() {
    let mut h = Harness::new("demo");
    let before = h.auction_config().auditor_elgamal_pubkey;
    let admin = h.admin.insecure_clone();

    let index = h.open_epoch();
    assert!(h.auction_config().has_open_epoch);
    // Every bid in this epoch is encrypted to the key the epoch recorded when it opened. Rotating
    // now would strand them: the print would prove its aggregates against a key nobody encrypted to.
    let err = h.rotate_auditor(&admin, NEW_KEY).unwrap_err();
    assert!(err.has_code("EpochOpen"), "rotated mid-window: {err}");
    assert_eq!(h.auction_config().auditor_elgamal_pubkey, before);

    // Closed, it is allowed.
    h.close_epoch(index);
    assert!(!h.auction_config().has_open_epoch);
    h.rotate_auditor(&admin, NEW_KEY).expect("rotate once closed");
    assert_eq!(h.auction_config().auditor_elgamal_pubkey, NEW_KEY);
}

#[test]
fn an_epoch_keeps_the_key_it_was_opened_under() {
    let mut h = Harness::new("demo");
    let old = h.auction_config().auditor_elgamal_pubkey;
    let admin = h.admin.insecure_clone();

    let first = h.open_epoch();
    assert_eq!(h.epoch(first).auditor_pubkey, old, "the epoch records the key in force");
    h.close_epoch(first);

    h.rotate_auditor(&admin, NEW_KEY).expect("rotate");

    // The rotation is forward-only. The closed epoch still names the key its bids were sealed to —
    // so a print that has not happened yet is still provable — and the next epoch takes the new one.
    assert_eq!(h.epoch(first).auditor_pubkey, old, "a past epoch's key was rewritten");
    let second = h.open_epoch();
    assert_eq!(h.epoch(second).auditor_pubkey, NEW_KEY, "the new epoch did not take the new key");
    assert_ne!(h.epoch(first).auditor_pubkey, h.epoch(second).auditor_pubkey);
}
