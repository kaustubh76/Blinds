//! `window-admin zk-probe`: does this machine's ZK ElGamal proof program agree with this binary?
//!
//! Tier 2 on GitHub's x86_64 Linux runner refuses the escrow account's `VerifyPubkeyValidity` while
//! the byte-identical validator build accepts the same proofs on macOS. Two transactions that carry
//! nothing but a pubkey-validity proof separate the suspects: the proof this binary makes, and the
//! proof macOS made (`window_client::ct::fixture`). Refusing the macOS bytes means the validator on
//! this machine verifies differently; accepting them while refusing ours means our bytes differ.
use anyhow::Result;
use solana_keypair::Keypair;
use solana_zk_elgamal_proof_interface::{
    instruction::ProofInstruction, proof_data::PubkeyValidityProofData,
};
use solana_zk_sdk::zk_elgamal_proof_program::{build_pubkey_validity_proof_data, VerifyZkProof};
use window_client::ct::{fixture, ConfidentialKeys};

use crate::chain::Chain;

pub struct Verdict {
    pub pubkey_matches_fixture: bool,
    pub own_proof_local: bool,
    pub own_proof_chain: Result<String, String>,
    pub fixture_proof_local: bool,
    pub fixture_proof_chain: Result<String, String>,
}

fn send_only_proof(
    chain: &dyn Chain,
    payer: &Keypair,
    data: &PubkeyValidityProofData,
) -> Result<String, String> {
    let ix = ProofInstruction::VerifyPubkeyValidity.encode_verify_proof(None, data);
    chain.send(payer, &[ix], &[]).map_err(|e| format!("{e:#}"))
}

pub fn run(chain: &dyn Chain, payer: &Keypair) -> Result<Verdict> {
    let keys = ConfidentialKeys::from_seed(&fixture::SEED, fixture::LABEL);
    let pubkey_hex = hex::encode(keys.elgamal.pubkey().to_bytes());
    println!("escrow pubkey (seed 0x11×32): {pubkey_hex}");
    let pubkey_matches_fixture = pubkey_hex == fixture::PUBKEY_HEX;
    println!("  equals the macOS fixture: {pubkey_matches_fixture}");

    let own = build_pubkey_validity_proof_data(&keys.elgamal)?;
    let own_proof_local = own.verify_proof().is_ok();
    println!("own proof: {}", hex::encode(bytemuck::bytes_of(&own)));
    println!("  verifies in this binary: {own_proof_local}");
    let own_proof_chain = send_only_proof(chain, payer, &own);
    println!("  accepted by the chain: {}", describe(&own_proof_chain));

    let bytes = hex::decode(fixture::PROOF_HEX)?;
    let fixture_data: &PubkeyValidityProofData = bytemuck::from_bytes(&bytes);
    let fixture_proof_local = fixture_data.verify_proof().is_ok();
    println!("macOS proof: verifies in this binary: {fixture_proof_local}");
    let fixture_proof_chain = send_only_proof(chain, payer, fixture_data);
    println!("  accepted by the chain: {}", describe(&fixture_proof_chain));

    println!(
        "verdict: own-proof {} · macos-proof {} → {}",
        ok_word(&own_proof_chain),
        ok_word(&fixture_proof_chain),
        match (own_proof_chain.is_ok(), fixture_proof_chain.is_ok()) {
            (true, true) => "this machine agrees with macOS",
            (false, false) => "the validator on this machine refuses a proof macOS's validator accepts — validator-side",
            (false, true) => "the validator accepts macOS's bytes but not ours — this binary's proof bytes differ",
            (true, false) => "our proof passes but macOS's does not — the fixture is stale; regenerate it",
        }
    );
    Ok(Verdict {
        pubkey_matches_fixture,
        own_proof_local,
        own_proof_chain,
        fixture_proof_local,
        fixture_proof_chain,
    })
}

fn describe(r: &Result<String, String>) -> String {
    match r {
        Ok(sig) => format!("yes ({sig})"),
        Err(e) => format!(
            "NO — {}",
            e.lines()
                .find(|l| l.contains("proof_verification") || l.contains("failed"))
                .unwrap_or(e.as_str())
                .trim()
        ),
    }
}
fn ok_word(r: &Result<String, String>) -> &'static str {
    if r.is_ok() {
        "ok"
    } else {
        "refused"
    }
}
