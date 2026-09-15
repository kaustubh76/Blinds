//! Key material: the one disclosed operational key and the seeds that derive the ElGamal keys.

use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use solana_keypair::Keypair;
use window_client::ct::ConfidentialKeys;
use window_elgamal::keys::Keypair as ElGamalKp;

pub struct Keys {
    pub admin: Keypair,
    /// 32-byte seed from `WINDOW_AUDITOR_SEED_HEX`; derives the auditor, the escrow and the agents.
    pub seed: [u8; 32],
}

impl Keys {
    pub fn load(keypair_path: Option<PathBuf>, seed_hex: Option<String>) -> Result<Self> {
        let path = keypair_path.unwrap_or_else(|| dirs_home().join(".config/solana/id.json"));
        let bytes: Vec<u8> = serde_json::from_str(
            &std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?,
        )?;
        let admin = Keypair::try_from(bytes.as_slice()).map_err(|e| anyhow!("keypair: {e}"))?;
        let seed_hex = seed_hex
            .ok_or_else(|| anyhow!("WINDOW_AUDITOR_SEED_HEX is required (32 bytes hex)"))?;
        let seed: [u8; 32] = hex::decode(seed_hex.trim())?
            .try_into()
            .map_err(|_| anyhow!("seed must be 32 bytes"))?;
        Ok(Self { admin, seed })
    }

    pub fn auditor(&self) -> ElGamalKp {
        let mut s = self.seed.to_vec();
        s.extend_from_slice(b"thewindow:auditor:v1");
        ElGamalKp::from_seed(&s).expect("seed")
    }
    pub fn escrow(&self) -> ConfidentialKeys {
        ConfidentialKeys::from_seed(&self.seed, "thewindow:escrow:v1")
    }
    pub fn agent_wallet(&self, i: usize) -> Keypair {
        let mut s = self.seed.to_vec();
        s.extend_from_slice(format!("thewindow:agent:{i}").as_bytes());
        Keypair::new_from_array(solana_keypair_seed(&s))
    }
    pub fn agent_elgamal(&self, i: usize) -> ElGamalKp {
        let mut s = self.seed.to_vec();
        s.extend_from_slice(format!("thewindow:agent-elgamal:{i}").as_bytes());
        ElGamalKp::from_seed(&s).expect("seed")
    }
    pub fn agent_token_keys(&self, i: usize) -> ConfidentialKeys {
        ConfidentialKeys::from_seed(&self.seed, &format!("thewindow:agent-token:{i}"))
    }
}

fn solana_keypair_seed(input: &[u8]) -> [u8; 32] {
    use std::hash::Hasher;
    // sha256 via the zk-sdk's dependency is overkill; a 32-byte seed from two 64-bit hashes of
    // a labelled input is fine for *simulated* agents (not for real users).
    let mut out = [0u8; 32];
    for (i, chunk) in out.chunks_mut(8).enumerate() {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        h.write(input);
        h.write_u8(i as u8);
        chunk.copy_from_slice(&h.finish().to_le_bytes());
    }
    out
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}
