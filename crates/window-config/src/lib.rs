//! Typed access to `config/<profile>.toml`.
//!
//! Every process that needs a market parameter — the admin service, setup scripts, the test
//! harness — reads it from here, so the on-chain `Config` accounts, the keeper's clock and the
//! tests can never disagree about what an epoch is.

use std::{collections::BTreeMap, path::Path};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub market: Market,
    pub credit: Credit,
    pub print: Print,
    #[serde(default)]
    pub assets: BTreeMap<String, Asset>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Market {
    pub epoch_slots: u64,
    pub tenor_slots: u64,
    pub keeper_grace_slots: u64,
    pub stale_after_slots: u64,
    pub max_price_age_slots: u64,
    pub band_edge_epochs: u8,
    pub max_bids_per_epoch: u32,
    pub bid_min_micro_usdc: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Credit {
    pub haircut_bps: u64,
    pub collateral_bits: u32,
    pub price_exp: i32,
    pub mult_exp: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Print {
    pub attest_batch: u8,
    pub bsgs_baby_bits: u8,
    pub bsgs_max_bits: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Asset {
    pub symbol: String,
    pub decimals: u8,
    /// Pyth feed id, 32 bytes hex. The documented all-zero id marks a profile whose price is the
    /// local mock walk, so a mock price is never published under a real Pyth feed id (A11).
    pub pyth_feed_id: String,
    /// Pyth `PriceUpdateV2` account holding that feed, read over `price_rpc_url`. Empty on the
    /// mock profiles.
    #[serde(default)]
    pub price_account: String,
    /// RPC the price account is read from — Pyth publishes equity feeds on mainnet, so this is a
    /// different cluster from the one the desk runs on. Empty on the mock profiles.
    #[serde(default)]
    pub price_rpc_url: String,
    pub initial_multiplier: f64,
}

impl Asset {
    /// `true` when this asset is priced by the documented local mock walk rather than by Pyth.
    pub fn is_mock_price(&self) -> bool {
        let id = self.pyth_feed_id.trim_start_matches("0x");
        id.is_empty() || id.chars().all(|c| c == '0')
    }

    pub fn feed_id_bytes(&self) -> Option<[u8; 32]> {
        let id = self.pyth_feed_id.trim_start_matches("0x");
        hex_32(id)
    }
}

fn hex_32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(s.get(2 * i..2 * i + 2)?, 16).ok()?;
    }
    Some(out)
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("cannot read {path}: {source}")]
    Io { path: String, source: std::io::Error },
    #[error("cannot parse {path}: {source}")]
    Parse { path: String, source: toml::de::Error },
    #[error("invalid profile: {0}")]
    Invalid(String),
}

impl Profile {
    /// Loads `config/<name>.toml` relative to the workspace root (found via `CARGO_MANIFEST_DIR`
    /// at build time or `WINDOW_ROOT` at run time).
    pub fn load(name: &str) -> Result<Self, ConfigError> {
        let root = std::env::var("WINDOW_ROOT")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."));
        Self::from_path(root.join("config").join(format!("{name}.toml")))
    }

    pub fn from_path(path: impl AsRef<Path>) -> Result<Self, ConfigError> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path)
            .map_err(|source| ConfigError::Io { path: path.display().to_string(), source })?;
        let profile: Self = toml::from_str(&text)
            .map_err(|source| ConfigError::Parse { path: path.display().to_string(), source })?;
        profile.validate()?;
        Ok(profile)
    }

    /// Structural sanity that the on-chain `initialize` instructions also enforce.
    pub fn validate(&self) -> Result<(), ConfigError> {
        let m = &self.market;
        let bad = |what: &str| Err(ConfigError::Invalid(what.to_string()));
        if m.epoch_slots == 0 || m.tenor_slots == 0 {
            return bad("epoch_slots and tenor_slots must be > 0");
        }
        if m.stale_after_slots <= m.keeper_grace_slots {
            return bad("stale_after_slots must exceed keeper_grace_slots");
        }
        if self.credit.haircut_bps < 10_000 {
            return bad("haircut_bps must be >= 10000 (100%)");
        }
        if self.credit.collateral_bits == 0 || self.credit.collateral_bits > 40 {
            return bad("collateral_bits must be in 1..=40");
        }
        if self.print.attest_batch == 0 || self.print.attest_batch > 4 {
            return bad("attest_batch must be in 1..=4 (tx size)");
        }
        if self.print.bsgs_max_bits > 63 || self.print.bsgs_baby_bits >= self.print.bsgs_max_bits {
            return bad("bsgs bits out of range");
        }
        for (name, a) in &self.assets {
            if a.feed_id_bytes().is_none() {
                return bad(&format!("{name}: pyth_feed_id must be 32 bytes hex"));
            }
            // A real feed id must name the on-chain account it is read from, and vice versa:
            // that pairing is what makes the posted price checkable by anyone.
            if a.is_mock_price() != a.price_account.is_empty() {
                return bad(&format!(
                    "{name}: a real pyth_feed_id needs a price_account (and the mock id must have none)"
                ));
            }
            if !a.price_account.is_empty() && a.price_rpc_url.is_empty() {
                return bad(&format!("{name}: price_account needs price_rpc_url"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shipped_profile_loads_and_validates() {
        for name in ["demo", "integration", "prod"] {
            let p = Profile::load(name).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(p.credit.haircut_bps, 15_000, "{name}: haircut is fixed at 150%");
            assert_eq!(p.market.bid_min_micro_usdc, 1_000_000);
            assert!(p.assets.contains_key("mock_tsla"));
        }
    }

    #[test]
    fn local_profiles_price_from_the_mock_walk_and_never_borrow_a_real_feed_id() {
        for name in ["demo", "integration"] {
            let a = &Profile::load(name).unwrap().assets["mock_tsla"];
            assert!(a.is_mock_price(), "{name} runs on localnet: it must not claim a Pyth feed");
            assert!(a.price_account.is_empty());
        }
    }

    #[test]
    fn deployed_profiles_name_the_pyth_account_their_feed_id_lives_in() {
        for name in ["devnet", "prod"] {
            let a = &Profile::load(name).unwrap().assets["mock_tsla"];
            assert!(!a.is_mock_price(), "{name}: a deployed desk posts a real published price");
            assert!(!a.price_account.is_empty() && !a.price_rpc_url.is_empty());
        }
    }

    #[test]
    fn integration_profile_is_fast() {
        let p = Profile::load("integration").unwrap();
        assert!(p.market.epoch_slots <= 30, "tier-2 tests must finish an epoch in seconds");
    }

    #[test]
    fn invalid_profiles_are_rejected() {
        let mut p = Profile::load("demo").unwrap();
        p.credit.haircut_bps = 9_000;
        assert!(matches!(p.validate(), Err(ConfigError::Invalid(_))));
    }
}
