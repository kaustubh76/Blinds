//! `deployments/<cluster>.json` — what `setup` wrote and what everything else reads.

use std::{collections::BTreeMap, path::PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use solana_pubkey::Pubkey;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Deployment {
    pub cluster: String,
    pub profile: String,
    pub programs: BTreeMap<String, String>,
    /// Listing #0's mints, escrow and feed id — mirrors `listings[0]` for readers that predate
    /// the collateral schedule (the dashboard bundle, the tier-2 harness).
    pub mock_mint: String,
    pub cstock_mint: String,
    pub decimals: u8,
    pub escrow_account: String,
    pub feed_id_hex: String,
    pub auditor_elgamal_pubkey_hex: String,
    /// The collateral schedule, in profile order.
    #[serde(default)]
    pub listings: Vec<ListingRecord>,
    pub agents: Vec<AgentRecord>,
}

/// One `Listing` account and what it was made from.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListingRecord {
    /// The profile key (`mock_tsla`, `tessera_openai`, …).
    pub key: String,
    pub symbol: String,
    /// `pyth` | `tessera` | `prestocks` | `mock`.
    pub source: String,
    /// The `Listing` PDA.
    pub listing: String,
    pub mock_mint: String,
    pub cstock_mint: String,
    pub escrow_account: String,
    pub feed_id_hex: String,
    pub decimals: u8,
    pub haircut_bps: u64,
    pub max_price_age_slots: u64,
    pub max_publish_age_secs: i64,
}

impl ListingRecord {
    pub fn feed_id(&self) -> [u8; 32] {
        hex::decode(&self.feed_id_hex).ok().and_then(|v| v.try_into().ok()).unwrap_or([0u8; 32])
    }
    pub fn listing_pda(&self) -> Result<Pubkey> {
        self.listing.parse().context("listing pda")
    }
    pub fn mock_mint(&self) -> Result<Pubkey> {
        self.mock_mint.parse().context("mock mint")
    }
    pub fn cstock_mint(&self) -> Result<Pubkey> {
        self.cstock_mint.parse().context("cstock mint")
    }
    pub fn escrow(&self) -> Result<Pubkey> {
        self.escrow_account.parse().context("escrow")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRecord {
    pub index: usize,
    pub wallet: String,
    pub mock_account: String,
    pub cstock_account: String,
    pub role: String,
    /// Index into `listings`: the collateral this agent holds accounts for.
    #[serde(default)]
    pub listing: usize,
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

    /// The listing a loan is bound to, by its `Loan.listing` PDA.
    pub fn listing_by_pda(&self, pda: &Pubkey) -> Option<&ListingRecord> {
        let s = pda.to_string();
        self.listings.iter().find(|l| l.listing == s)
    }

    pub fn listing_by_key(&self, key: &str) -> Option<&ListingRecord> {
        self.listings.iter().find(|l| l.key == key)
    }

    /// The listing an agent record holds accounts for.
    pub fn listing_of(&self, agent: &AgentRecord) -> Result<&ListingRecord> {
        self.listings.get(agent.listing).ok_or_else(|| {
            anyhow::anyhow!(
                "agent {} names listing {} which does not exist",
                agent.index,
                agent.listing
            )
        })
    }

    /// Keeps the legacy top-level fields equal to listing #0.
    pub fn mirror_primary(&mut self) {
        if let Some(l) = self.listings.first() {
            self.mock_mint = l.mock_mint.clone();
            self.cstock_mint = l.cstock_mint.clone();
            self.decimals = l.decimals;
            self.escrow_account = l.escrow_account.clone();
            self.feed_id_hex = l.feed_id_hex.clone();
        }
    }
}

pub fn workspace_root() -> PathBuf {
    std::env::var("WINDOW_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}
