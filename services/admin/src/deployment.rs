//! `deployments/<cluster>.json` — what `setup` wrote and what everything else reads.

use std::{collections::BTreeMap, path::PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Deployment {
    pub cluster: String,
    pub profile: String,
    pub programs: BTreeMap<String, String>,
    pub mock_mint: String,
    pub cstock_mint: String,
    pub decimals: u8,
    pub escrow_account: String,
    pub feed_id_hex: String,
    pub auditor_elgamal_pubkey_hex: String,
    pub agents: Vec<AgentRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRecord {
    pub index: usize,
    pub wallet: String,
    pub mock_account: String,
    pub cstock_account: String,
    pub role: String,
}

impl Deployment {
    pub fn path(root: &std::path::Path, cluster: &str) -> PathBuf {
        root.join("deployments").join(format!("{cluster}.json"))
    }
    pub fn load(root: &std::path::Path, cluster: &str) -> Result<Self> {
        let p = Self::path(root, cluster);
        serde_json::from_str(
            &std::fs::read_to_string(&p).with_context(|| format!("read {}", p.display()))?,
        )
        .context("parse deployment")
    }
    pub fn save(&self, root: &std::path::Path) -> Result<()> {
        let p = Self::path(root, &self.cluster);
        std::fs::write(&p, serde_json::to_string_pretty(self)?)
            .with_context(|| format!("write {}", p.display()))
    }
    pub fn feed_id(&self) -> [u8; 32] {
        hex::decode(&self.feed_id_hex).ok().and_then(|v| v.try_into().ok()).unwrap_or([0u8; 32])
    }
}

pub fn workspace_root() -> PathBuf {
    std::env::var("WINDOW_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}
