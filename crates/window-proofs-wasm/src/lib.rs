//! Browser proofs. Every function takes/returns plain bytes or JSON so the TypeScript SDK stays
//! thin. Secrets (openings, keys) live in the page's memory only.

use serde::Serialize;
use wasm_bindgen::prelude::*;
use window_elgamal::{encrypt::Opening, keys::Keypair, Ciphertext, GroupedCiphertext2};
use window_proofs::{bid, scalar, solvency, verify};

fn js<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// The message a wallet signs to derive its confidential keys (`"solana-conf-bal/v1" ‖ seed`).
#[wasm_bindgen]
pub fn signing_message(seed: &[u8]) -> Vec<u8> {
    window_elgamal::keys::signing_message(seed)
}

/// ElGamal public key (32 bytes) derived from a 64-byte wallet signature.
#[wasm_bindgen]
pub fn elgamal_pubkey_from_signature(signature: &[u8]) -> Result<Vec<u8>, JsValue> {
    let sig: [u8; 64] = signature.try_into().map_err(|_| js("signature must be 64 bytes"))?;
    Ok(Keypair::from_signature(&sig).map_err(js)?.pubkey_bytes().to_vec())
}

#[derive(Serialize)]
struct BidOut {
    ciphertext: Vec<u8>,
    opening: Vec<u8>,
    validity: Vec<u8>,
    range: Vec<u8>,
}

/// Bid proofs for `size` micro-USDC (as a decimal string) with minimum `s_min`.
#[wasm_bindgen]
pub fn bid_proofs(
    signature: &[u8],
    auditor_pubkey: &[u8],
    size: &str,
    s_min: &str,
) -> Result<JsValue, JsValue> {
    let sig: [u8; 64] = signature.try_into().map_err(|_| js("signature must be 64 bytes"))?;
    let kp = Keypair::from_signature(&sig).map_err(js)?;
    let auditor: [u8; 32] =
        auditor_pubkey.try_into().map_err(|_| js("auditor key must be 32 bytes"))?;
    let size: u64 = size.parse().map_err(js)?;
    let s_min: u64 = s_min.parse().map_err(js)?;
    let p = bid::build(&kp, &auditor, size, s_min).map_err(js)?;
    let out = BidOut {
        ciphertext: p.ciphertext.to_bytes().to_vec(),
        opening: p.opening.0.to_bytes().to_vec(),
        validity: bytemuck::bytes_of(&p.validity).to_vec(),
        range: bytemuck::bytes_of(&p.range).to_vec(),
    };
    serde_wasm_bindgen::to_value(&out).map_err(js)
}

#[derive(Serialize)]
struct LockOut {
    collateral_ciphertext: Vec<u8>,
    collateral_opening: Vec<u8>,
    validity: Vec<u8>,
    range32: Vec<u8>,
    delta_commitment: Vec<u8>,
    equality: Vec<u8>,
    range64: Vec<u8>,
    k_c: String,
    k_l: String,
}

/// The four proofs of a lock. `loan_ciphertext` is the loan's 96-byte grouped ciphertext,
/// `loan_opening` its 32-byte opening (own bid, or the sealed note opened with `open_note`).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn lock_proofs(
    signature: &[u8],
    auditor_pubkey: &[u8],
    shares_milli: &str,
    loan_ciphertext: &[u8],
    loan_size: &str,
    loan_opening: &[u8],
    price_cents: &str,
    mult_scaled: &str,
    haircut_bps: &str,
) -> Result<JsValue, JsValue> {
    let sig: [u8; 64] = signature.try_into().map_err(|_| js("signature must be 64 bytes"))?;
    let kp = Keypair::from_signature(&sig).map_err(js)?;
    let auditor: [u8; 32] = auditor_pubkey.try_into().map_err(|_| js("auditor key"))?;
    let c: u64 = shares_milli.parse().map_err(js)?;
    let l: u64 = loan_size.parse().map_err(js)?;
    let scalars = scalar::solvency_scalars(
        price_cents.parse().map_err(js)?,
        mult_scaled.parse().map_err(js)?,
        haircut_bps.parse().map_err(js)?,
    )
    .ok_or_else(|| js("scalars"))?;
    let claim = solvency::build_collateral(&kp, &auditor, c).map_err(js)?;
    let loan_ct = GroupedCiphertext2::from_bytes(
        loan_ciphertext.try_into().map_err(|_| js("loan ciphertext must be 96 bytes"))?,
    );
    let el = loan_ct.to_ciphertext(0).ok_or_else(|| js("loan ct"))?;
    let ec = claim.ciphertext.to_ciphertext(0).ok_or_else(|| js("coll ct"))?;
    let opening = Opening(
        solana_zk_sdk::encryption::pedersen::PedersenOpening::from_bytes(loan_opening)
            .ok_or_else(|| js("loan opening"))?,
    );
    let pair = solvency::build(
        &kp,
        &solvency::SolvencyInputs {
            collateral: &ec,
            c,
            c_opening: &claim.opening,
            loan: &el,
            l,
            l_opening: &opening,
        },
        &scalars,
    )
    .map_err(js)?;
    let out = LockOut {
        collateral_ciphertext: claim.ciphertext.to_bytes().to_vec(),
        collateral_opening: claim.opening.0.to_bytes().to_vec(),
        validity: bytemuck::bytes_of(&claim.validity).to_vec(),
        range32: bytemuck::bytes_of(&claim.range).to_vec(),
        delta_commitment: pair.delta_commitment.0.to_vec(),
        equality: bytemuck::bytes_of(&pair.equality).to_vec(),
        range64: bytemuck::bytes_of(&pair.range).to_vec(),
        k_c: scalars.k_c.to_string(),
        k_l: scalars.k_l.to_string(),
    };
    serde_wasm_bindgen::to_value(&out).map_err(js)
}

/// Opens a partial-fill opening note sealed by the administrator (ECDH with the auditor key).
#[wasm_bindgen]
pub fn open_note(
    signature: &[u8],
    auditor_pubkey: &[u8],
    note: &[u8],
    loan_address: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let sig: [u8; 64] = signature.try_into().map_err(|_| js("signature"))?;
    let kp = Keypair::from_signature(&sig).map_err(js)?;
    let auditor: [u8; 32] = auditor_pubkey.try_into().map_err(|_| js("auditor key"))?;
    let note: [u8; 32] = note.try_into().map_err(|_| js("note"))?;
    let shared = window_elgamal::note::shared_secret(&kp, &auditor).map_err(js)?;
    window_elgamal::note::open(&note, &shared, loan_address)
        .map(|o| o.to_vec())
        .ok_or_else(|| js("bad note"))
}

/// Whether a 64-byte ciphertext under the member's key encrypts `expected`.
#[wasm_bindgen]
pub fn ciphertext_equals(
    signature: &[u8],
    ciphertext: &[u8],
    expected: &str,
) -> Result<bool, JsValue> {
    let sig: [u8; 64] = signature.try_into().map_err(|_| js("signature"))?;
    let kp = Keypair::from_signature(&sig).map_err(js)?;
    let ct = Ciphertext::from_bytes(
        ciphertext.try_into().map_err(|_| js("ciphertext must be 64 bytes"))?,
    );
    Ok(window_elgamal::decrypt::equals(&kp, &ct, expected.parse().map_err(js)?))
}

/// Recovers the plaintext of a member-key ciphertext below `max` (small values only; BSGS 2^16 table).
#[wasm_bindgen]
pub fn decrypt_small(
    signature: &[u8],
    ciphertext: &[u8],
    max: &str,
) -> Result<Option<String>, JsValue> {
    let sig: [u8; 64] = signature.try_into().map_err(|_| js("signature"))?;
    let kp = Keypair::from_signature(&sig).map_err(js)?;
    let ct = Ciphertext::from_bytes(
        ciphertext.try_into().map_err(|_| js("ciphertext must be 64 bytes"))?,
    );
    let solver = window_elgamal::bsgs::Solver::build(16);
    Ok(solver.decrypt(&kp, &ct, max.parse().map_err(js)?).map(|v| v.to_string()))
}

/// Re-verifies a print from raw account data: `epoch` (Epoch account data), `print` (Print account
/// data) and the concatenated 192-byte PoCD proof data blobs extracted from the attest transactions.
#[wasm_bindgen]
pub fn verify_print(
    epoch_data: &[u8],
    print_data: &[u8],
    proofs: &[u8],
) -> Result<JsValue, JsValue> {
    use solana_zk_elgamal_proof_interface::proof_data::ZeroCiphertextProofData;
    use window_clearing::TICKS;
    const EPOCH_HDR: usize = 8 + 8 + 8 + 8; // disc + index + start + close
    if epoch_data.len() < EPOCH_HDR + 32 + 2 * TICKS * 32 * 2 + 2 * TICKS * 4 {
        return Err(js("epoch data too short"));
    }
    let mut off = EPOCH_HDR;
    let auditor_pubkey: [u8; 32] = epoch_data[off..off + 32].try_into().unwrap();
    off += 32;
    let mut acc = [[Ciphertext::ZERO; TICKS]; 2];
    let mut comm = [[[0u8; 32]; TICKS]; 2];
    for side in comm.iter_mut() {
        for c in side.iter_mut() {
            c.copy_from_slice(&epoch_data[off..off + 32]);
            off += 32;
        }
    }
    for (side, comm_side) in acc.iter_mut().zip(comm.iter()) {
        for (ct, c) in side.iter_mut().zip(comm_side.iter()) {
            let mut h = [0u8; 32];
            h.copy_from_slice(&epoch_data[off..off + 32]);
            off += 32;
            *ct = Ciphertext {
                commitment: window_elgamal::Point(*c),
                handle: window_elgamal::Point(h),
            };
        }
    }
    let mut bid_count = [[0u32; TICKS]; 2];
    for side in bid_count.iter_mut() {
        for n in side.iter_mut() {
            *n = u32::from_le_bytes(epoch_data[off..off + 4].try_into().unwrap());
            off += 4;
        }
    }
    let ev = verify::EpochView { auditor_pubkey, acc, bid_count };
    // Print: disc(8) epoch(8) claimed_sum(2*37*8) matched(8) num(8) den(8) finalized(8) matches_posted(4) tau(2) attested(1) status(1) missed(1) r_star(1) ...
    if print_data.len() < 8 + 8 + 2 * TICKS * 8 + 8 * 4 + 4 + 2 + 4 {
        return Err(js("print data too short"));
    }
    let mut p = 16;
    let mut claimed = [[0u64; TICKS]; 2];
    for side in claimed.iter_mut() {
        for v in side.iter_mut() {
            *v = u64::from_le_bytes(print_data[p..p + 8].try_into().unwrap());
            p += 8;
        }
    }
    let matched = u64::from_le_bytes(print_data[p..p + 8].try_into().unwrap());
    p += 8 * 4 + 4 + 2 + 1;
    let status = print_data[p];
    let r_star = print_data[p + 2];
    let pv = verify::PrintView {
        claimed_sum: claimed,
        r_star_tick: if status == 3 { Some(r_star) } else { None },
        matched,
    };
    let (chunks, _) = proofs.as_chunks::<192>();
    let proofs: Vec<ZeroCiphertextProofData> =
        chunks.iter().map(|c| *bytemuck::from_bytes::<ZeroCiphertextProofData>(c)).collect();
    let v = verify::print(&ev, &pv, &proofs);
    #[derive(Serialize)]
    struct Out {
        ok: bool,
        nonzero: usize,
        proven: usize,
        r_star_recomputed: Option<u8>,
        failures: Vec<String>,
    }
    serde_wasm_bindgen::to_value(&Out {
        ok: v.ok,
        nonzero: v.nonzero,
        proven: v.proven,
        r_star_recomputed: v.r_star_recomputed,
        failures: v.failures,
    })
    .map_err(js)
}

// ---------------------------------------------------------------- Token-2022 confidential balance

use solana_zk_sdk::encryption::{
    auth_encryption::AeCiphertext, derivation::derive_confidential_keys_from_ikm,
    elgamal::ElGamalCiphertext,
};
use solana_zk_sdk_pod::encryption::auth_encryption::PodAeCiphertext;

fn token_keys(
    signature: &[u8],
) -> Result<
    (
        solana_zk_sdk::encryption::elgamal::ElGamalKeypair,
        solana_zk_sdk::encryption::auth_encryption::AeKey,
    ),
    JsValue,
> {
    let sig: [u8; 64] = signature.try_into().map_err(|_| js("signature must be 64 bytes"))?;
    derive_confidential_keys_from_ikm(&sig).map_err(js)
}

/// Keys for a confidential token account derived from the wallet's signature over
/// `signing_message(token_account_address)`: returns `elgamal_pubkey ‖ pubkey_validity_proof_data`.
#[wasm_bindgen]
pub fn token_account_keys(signature: &[u8]) -> Result<JsValue, JsValue> {
    let (elgamal, ae) = token_keys(signature)?;
    let proof = solana_zk_sdk::zk_elgamal_proof_program::build_pubkey_validity_proof_data(&elgamal)
        .map_err(js)?;
    #[derive(Serialize)]
    struct Out {
        elgamal_pubkey: Vec<u8>,
        pubkey_validity_proof: Vec<u8>,
        decryptable_zero_balance: Vec<u8>,
    }
    let zero: PodAeCiphertext = ae.encrypt(0).into();
    serde_wasm_bindgen::to_value(&Out {
        elgamal_pubkey: elgamal.pubkey().to_bytes().to_vec(),
        pubkey_validity_proof: bytemuck::bytes_of(&proof).to_vec(),
        decryptable_zero_balance: zero.0.to_vec(),
    })
    .map_err(js)
}

/// Decrypts a confidential balance view: `(available, pending)` from the account's extension bytes
/// (`decryptable_available_balance` 36 B, `pending_lo` 64 B, `pending_hi` 64 B).
#[wasm_bindgen]
pub fn confidential_balances(
    signature: &[u8],
    decryptable: &[u8],
    pending_lo: &[u8],
    pending_hi: &[u8],
) -> Result<JsValue, JsValue> {
    let (elgamal, ae) = token_keys(signature)?;
    let ae_ct = AeCiphertext::from_bytes(decryptable).ok_or_else(|| js("decryptable"))?;
    let available =
        ae.decrypt(&ae_ct).ok_or_else(|| js("cannot decrypt available balance with this key"))?;
    let lo = ElGamalCiphertext::from_bytes(pending_lo).ok_or_else(|| js("pending lo"))?;
    let hi = ElGamalCiphertext::from_bytes(pending_hi).ok_or_else(|| js("pending hi"))?;
    let lo = elgamal.secret().decrypt_u32(&lo).unwrap_or(0);
    let hi = elgamal.secret().decrypt_u32(&hi).unwrap_or(0);
    #[derive(Serialize)]
    struct Out {
        available: String,
        pending: String,
    }
    serde_wasm_bindgen::to_value(&Out {
        available: available.to_string(),
        pending: (lo + (hi << 16)).to_string(),
    })
    .map_err(js)
}

/// New decryptable balance ciphertext (36 B) for `ApplyPendingBalance` / after a transfer.
#[wasm_bindgen]
pub fn encrypt_balance(signature: &[u8], amount: &str) -> Result<Vec<u8>, JsValue> {
    let (_, ae) = token_keys(signature)?;
    let ct: PodAeCiphertext = ae.encrypt(amount.parse().map_err(js)?).into();
    Ok(ct.0.to_vec())
}

/// Proofs for a confidential transfer: equality (161 B ctx / data 320 B), ciphertext validity
/// (3 handles, batched), and a u128 range proof, plus the auditor ciphertext lo/hi for the
/// instruction and the new source decryptable balance.
#[wasm_bindgen]
pub fn transfer_proofs(
    signature: &[u8],
    available_ct: &[u8],
    decryptable: &[u8],
    amount: &str,
    destination_elgamal_pubkey: &[u8],
    auditor_pubkey: &[u8],
) -> Result<JsValue, JsValue> {
    let (elgamal, ae) = token_keys(signature)?;
    let available =
        ElGamalCiphertext::from_bytes(available_ct).ok_or_else(|| js("available ct"))?;
    let ae_ct = AeCiphertext::from_bytes(decryptable).ok_or_else(|| js("decryptable"))?;
    let amount: u64 = amount.parse().map_err(js)?;
    let dest = window_elgamal::keys::pubkey_from_bytes(
        destination_elgamal_pubkey.try_into().map_err(|_| js("dest key"))?,
    )
    .map_err(js)?;
    let auditor = window_elgamal::keys::pubkey_from_bytes(
        auditor_pubkey.try_into().map_err(|_| js("auditor key"))?,
    )
    .map_err(js)?;
    let p = spl_token_confidential_transfer_proof_generation::transfer::transfer_split_proof_data(
        &available,
        &ae_ct,
        amount,
        &elgamal,
        &ae,
        &dest,
        Some(&auditor),
    )
    .map_err(js)?;
    let current = ae.decrypt(&ae_ct).ok_or_else(|| js("balance"))?;
    let new_balance: PodAeCiphertext =
        ae.encrypt(current.checked_sub(amount).ok_or_else(|| js("insufficient"))?).into();
    #[derive(Serialize)]
    struct Out {
        equality: Vec<u8>,
        validity: Vec<u8>,
        range: Vec<u8>,
        auditor_lo: Vec<u8>,
        auditor_hi: Vec<u8>,
        new_decryptable: Vec<u8>,
    }
    serde_wasm_bindgen::to_value(&Out {
        equality: bytemuck::bytes_of(&p.equality_proof_data).to_vec(),
        validity: bytemuck::bytes_of(&p.ciphertext_validity_proof_data_with_ciphertext.proof_data)
            .to_vec(),
        range: bytemuck::bytes_of(&p.range_proof_data).to_vec(),
        auditor_lo: p.ciphertext_validity_proof_data_with_ciphertext.ciphertext_lo.0.to_vec(),
        auditor_hi: p.ciphertext_validity_proof_data_with_ciphertext.ciphertext_hi.0.to_vec(),
        new_decryptable: new_balance.0.to_vec(),
    })
    .map_err(js)
}

/// Proofs for a confidential withdraw (equality + u64 range) and the new decryptable balance.
#[wasm_bindgen]
pub fn withdraw_proofs(
    signature: &[u8],
    available_ct: &[u8],
    decryptable: &[u8],
    amount: &str,
) -> Result<JsValue, JsValue> {
    let (elgamal, ae) = token_keys(signature)?;
    let available =
        ElGamalCiphertext::from_bytes(available_ct).ok_or_else(|| js("available ct"))?;
    let ae_ct = AeCiphertext::from_bytes(decryptable).ok_or_else(|| js("decryptable"))?;
    let current = ae.decrypt(&ae_ct).ok_or_else(|| js("balance"))?;
    let amount: u64 = amount.parse().map_err(js)?;
    let p = spl_token_confidential_transfer_proof_generation::withdraw::withdraw_proof_data(
        &available, current, amount, &elgamal,
    )
    .map_err(js)?;
    let new_balance: PodAeCiphertext =
        ae.encrypt(current.checked_sub(amount).ok_or_else(|| js("insufficient"))?).into();
    #[derive(Serialize)]
    struct Out {
        equality: Vec<u8>,
        range: Vec<u8>,
        new_decryptable: Vec<u8>,
    }
    serde_wasm_bindgen::to_value(&Out {
        equality: bytemuck::bytes_of(&p.equality_proof_data).to_vec(),
        range: bytemuck::bytes_of(&p.range_proof_data).to_vec(),
        new_decryptable: new_balance.0.to_vec(),
    })
    .map_err(js)
}
