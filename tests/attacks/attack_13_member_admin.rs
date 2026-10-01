//! Membership: the admin may evict, only the owner may re-key, and neither can act on a member that
//! is already gone.
//!
//! These two instructions had no test of any kind. The split between them is the point: admission is
//! admin-gated (spec v2 §7.1), so the admin can take a member out of the market — but it cannot
//! substitute a member's ElGamal key, because every bid that member seals is encrypted to that key
//! and to the auditor's. An admin that could re-key a member could make the next window's bids
//! readable by a key the member never chose. The program makes that impossible by construction: the
//! member account is a PDA of the owner's own address and `has_one = owner`.

use solana_signer::Signer;
use window_testkit::Harness;

const NEW_KEY: [u8; 32] = [9u8; 32];

#[test]
fn only_the_admin_evicts_and_only_once() {
    let mut h = Harness::new("demo");
    let i = h.add_member();
    let owner = h.members[i].wallet.pubkey();
    assert!(h.member_account(&owner).active);

    // The member cannot evict itself, and neither can a stranger.
    let me = h.members[i].wallet.insecure_clone();
    let err = h.remove_member(&me, &owner).unwrap_err();
    assert!(err.has_code("Unauthorized"), "a member evicted itself: {err}");
    assert!(h.member_account(&owner).active, "a refused call changed the account");

    // The admin can, and it is a soft delete: the account stays so the member's history and its
    // outstanding loans remain auditable.
    let admin = h.admin.insecure_clone();
    h.remove_member(&admin, &owner).expect("admin evicts");
    let m = h.member_account(&owner);
    assert!(!m.active);
    assert_eq!(m.owner, owner, "the account was closed rather than deactivated");

    // Twice is refused rather than silently idempotent — an eviction is an event, and emitting it
    // again would put a second `MemberRemoved` on a member that had already gone.
    let err = h.remove_member(&admin, &owner).unwrap_err();
    assert!(err.has_code("NotActive"), "{err}");
}

#[test]
fn a_member_re_keys_itself_and_the_admin_cannot_do_it_for_them() {
    let mut h = Harness::new("demo");
    let i = h.add_member();
    let owner = h.members[i].wallet.pubkey();
    let before = h.member_account(&owner).elgamal_pubkey;

    // The admin signing its own transaction addresses *its own* member PDA, which does not exist —
    // it cannot reach another member's account at all. That is the guarantee, stated as a test:
    // admission is admin-gated, but the key a member's bids are sealed to is never the admin's to set.
    let admin = h.admin.insecure_clone();
    assert!(h.update_elgamal_pubkey(&admin, NEW_KEY).is_err(), "the admin re-keyed a member");
    assert_eq!(h.member_account(&owner).elgamal_pubkey, before);

    // Another member cannot either, for the same reason: the PDA is seeded on the signer.
    let j = h.add_member();
    let other = h.members[j].wallet.insecure_clone();
    h.update_elgamal_pubkey(&other, NEW_KEY).expect("a member re-keys its own account");
    assert_eq!(h.member_account(&owner).elgamal_pubkey, before, "someone else's key moved");
    assert_eq!(h.member_account(&other.pubkey()).elgamal_pubkey, NEW_KEY);

    // The owner can, and a zero key is refused — it would make every handle decrypt to nothing.
    let me = h.members[i].wallet.insecure_clone();
    let err = h.update_elgamal_pubkey(&me, [0u8; 32]).unwrap_err();
    assert!(err.has_code("ZeroKey"), "{err}");
    h.update_elgamal_pubkey(&me, NEW_KEY).expect("the owner re-keys");
    assert_eq!(h.member_account(&owner).elgamal_pubkey, NEW_KEY);
}

#[test]
fn an_evicted_member_cannot_re_key_its_way_back_in() {
    let mut h = Harness::new("demo");
    let i = h.add_member();
    let owner = h.members[i].wallet.pubkey();
    let admin = h.admin.insecure_clone();
    h.remove_member(&admin, &owner).expect("evict");

    let me = h.members[i].wallet.insecure_clone();
    let err = h.update_elgamal_pubkey(&me, NEW_KEY).unwrap_err();
    assert!(err.has_code("NotActive"), "an evicted member re-keyed: {err}");
    assert!(!h.member_account(&owner).active);
}
