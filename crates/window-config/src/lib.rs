//! Typed access to `config/<profile>.toml`.
//!
//! Every process that needs a market parameter — the admin service, setup scripts, the test
//! harness — reads it from here, so the on-chain `Config` accounts, the keeper's clock and the
//! tests can never disagree about what an epoch is.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    pub market: Market,
    pub credit: Credit,
    pub print: Print,
    /// The collateral schedule: one entry per eligible collateral, in the order they are listed on
    /// chain. The first is the desk's original collateral (the one `window_credit::Config` names).
    #[serde(default)]
    pub listings: Vec<ListingCfg>,
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

/// Where a listing's price comes from. The tag is what `Listing.price_source` carries on chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PriceSourceKind {
    /// A Pyth feed: Hermes with a key, Pyth's on-chain accounts otherwise. The quote carries the
    /// publisher's own `publish_time`.
    Pyth = 0,
    /// Tag 1 is reserved: it was a second attested-mark source, retired from the desk on
    /// 2026-09-21 (its devnet listing stays on chain, refusing every lock). No profile may use it.
    Reserved1 = 1,
    /// PreStocks' public `/api/prestocks` mark price, copied by the keeper and timestamped at fetch.
    Prestocks = 2,
    /// The documented deterministic walk; localnet/CI only.
    Mock = 3,
}

impl PriceSourceKind {
    pub fn tag(self) -> u8 {
        self as u8
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Pyth => "pyth",
            Self::Reserved1 => "reserved",
            Self::Prestocks => "prestocks",
            Self::Mock => "mock",
        }
    }
}

/// One collateral listing (`[[listings]]`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ListingCfg {
    /// Stable handle used by the deployment descriptor and logs (`mock_tsla`).
    pub key: String,
    /// On-chain label, at most 16 bytes of UTF-8.
    pub symbol: String,
    pub decimals: u8,
    pub source: PriceSourceKind,
    /// Collateral must cover this many bps of the loan (≥ 10000).
    pub haircut_bps: u64,
    /// Keeper-post liveness in slots; defaults to `[market].max_price_age_slots`.
    #[serde(default)]
    pub max_price_age_slots: Option<u64>,
    /// Quote liveness: `now − publish_time` must not exceed this on chain.
    pub max_publish_age_secs: i64,
    pub initial_multiplier: f64,
    /// Pyth feed id, 32 bytes hex. Required for `source = "pyth"`; ignored otherwise.
    #[serde(default)]
    pub pyth_feed_id: String,
    /// Pyth `PriceUpdateV2` account holding that feed, read over `price_rpc_url` (one of the
    /// candidates; the push-oracle PDAs are always tried too).
    #[serde(default)]
    pub price_account: String,
    /// RPC the Pyth accounts are read from — Pyth publishes equity feeds on mainnet, so this is a
    /// different cluster from the one the desk runs on.
    #[serde(default)]
    pub price_rpc_url: String,
    /// PreStocks: the public endpoint returning the token array.
    #[serde(default)]
    pub source_url: String,
    /// PreStocks: the mainnet mint (`contract_address`) that
    /// identifies the element to read.
    #[serde(default)]
    pub source_mint: String,
    /// PreStocks: the sponsor's symbol, part of the feed-id label.
    #[serde(default)]
    pub source_symbol: String,
    /// PreStocks: the JSON field carrying the USD mark (`markPrice`).
    #[serde(default)]
    pub price_field: String,
    /// PreStocks: the JSON field carrying the token's implied (traded) price (`tokenPrice`), read
    /// beside the mark and served by the admin's `/marks` as the basis. Optional; never posted on chain.
    #[serde(default)]
    pub implied_field: String,
    /// PreStocks: the company's valuation at the mark and at the traded price, and the token supply
    /// (`markValuation`, `impliedValuation`, `supply`). All optional, all informational — `/marks` only.
    #[serde(default)]
    pub mark_valuation_field: String,
    #[serde(default)]
    pub implied_valuation_field: String,
    #[serde(default)]
    pub supply_field: String,
    /// Pyth: the push-oracle shard the desk's own poster (`services/pyth-poster`) writes this feed
    /// into on the desk's cluster. Set, the listing may run as `price_source = 4` and the program
    /// reads Pyth's receiver-owned `PriceUpdateV2` at `[shard, feed_id]` directly.
    #[serde(default)]
    pub pyth_shard: Option<u16>,
}

impl ListingCfg {
    /// `true` when this listing is priced by the documented local mock walk rather than by a source.
    pub fn is_mock_price(&self) -> bool {
        self.source == PriceSourceKind::Mock
    }

    /// The 32-byte id `PriceCache` is seeded on. A Pyth id for Pyth; the documented all-zero id
    /// for the mock walk; `sha256("<source>:<symbol>")` for an attested mark — a label, so that a
    /// mark can never be mistaken for a Pyth feed.
    pub fn feed_id(&self) -> Option<[u8; 32]> {
        match self.source {
            PriceSourceKind::Pyth => hex_32(self.pyth_feed_id.trim_start_matches("0x")),
            PriceSourceKind::Mock => Some([0u8; 32]),
            PriceSourceKind::Reserved1 => None,
            PriceSourceKind::Prestocks => {
                use sha2::Digest as _;
                let label = format!("{}:{}", self.source.label(), self.source_symbol);
                Some(sha2::Sha256::digest(label.as_bytes()).into())
            }
        }
    }

    /// Kept for the single-listing call sites: the Pyth feed id or the mock all-zero id.
    pub fn feed_id_bytes(&self) -> Option<[u8; 32]> {
        self.feed_id()
    }

    /// The on-chain `symbol` field: UTF-8, zero padded to 16 bytes.
    pub fn symbol_bytes(&self) -> [u8; 16] {
        let mut out = [0u8; 16];
        let b = self.symbol.as_bytes();
        out[..b.len().min(16)].copy_from_slice(&b[..b.len().min(16)]);
        out
    }

    pub fn max_price_age_slots(&self, market: &Market) -> u64 {
        self.max_price_age_slots.unwrap_or(market.max_price_age_slots)
    }
}

impl Profile {
    /// The desk's original collateral — listing #0, the one `window_credit::Config` names.
    pub fn primary(&self) -> &ListingCfg {
        &self.listings[0]
    }

    pub fn listing(&self, key: &str) -> Option<&ListingCfg> {
        self.listings.iter().find(|l| l.key == key)
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
        if self.listings.is_empty() {
            return bad("at least one [[listings]] entry is required");
        }
        for (i, l) in self.listings.iter().enumerate() {
            let name = &l.key;
            if self.listings[..i].iter().any(|o| o.key == l.key) {
                return bad(&format!("{name}: duplicate listing key"));
            }
            if l.symbol.is_empty() || l.symbol.len() > 16 {
                return bad(&format!("{name}: symbol must be 1..=16 bytes"));
            }
            if l.haircut_bps < 10_000 || !l.haircut_bps.is_multiple_of(100) {
                return bad(&format!("{name}: haircut_bps must be >= 10000 and a whole percent"));
            }
            if l.max_publish_age_secs <= 0 || l.max_price_age_slots == Some(0) {
                return bad(&format!("{name}: freshness limits must be > 0"));
            }
            match l.source {
                PriceSourceKind::Pyth => {
                    // A real feed id must name the account it is read from and the RPC: that
                    // pairing is what makes the posted price checkable by anyone.
                    let id = l.pyth_feed_id.trim_start_matches("0x");
                    if hex_32(id).is_none() || id.chars().all(|c| c == '0') {
                        return bad(&format!(
                            "{name}: pyth needs a real pyth_feed_id (32 bytes hex)"
                        ));
                    }
                    if l.price_account.is_empty() || l.price_rpc_url.is_empty() {
                        return bad(&format!("{name}: pyth needs price_account and price_rpc_url"));
                    }
                }
                PriceSourceKind::Reserved1 => {
                    return bad(&format!("{name}: price source 1 is reserved (retired)"));
                }
                PriceSourceKind::Prestocks => {
                    if l.source_url.is_empty()
                        || l.source_mint.is_empty()
                        || l.source_symbol.is_empty()
                    {
                        return bad(&format!("{name}: an attested mark needs source_url, source_mint and source_symbol"));
                    }
                    if l.price_field.is_empty() {
                        return bad(&format!("{name}: an attested mark needs price_field"));
                    }
                }
                PriceSourceKind::Mock => {
                    // The mock walk never borrows a real feed id or account (A11).
                    if !l.price_account.is_empty()
                        || l.pyth_feed_id.trim_start_matches("0x").chars().any(|c| c != '0')
                    {
                        return bad(&format!(
                            "{name}: a mock listing must not name a Pyth feed or account"
                        ));
                    }
                }
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
        for name in ["demo", "integration", "prod", "devnet"] {
            let p = Profile::load(name).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(p.credit.haircut_bps, 15_000, "{name}: the legacy haircut is fixed at 150%");
            assert_eq!(p.market.bid_min_micro_usdc, 1_000_000);
            assert_eq!(
                p.primary().key,
                "mock_tsla",
                "{name}: listing #0 is the original collateral"
            );
            assert_eq!(p.primary().haircut_bps, p.credit.haircut_bps);
        }
    }

    #[test]
    fn local_profiles_price_from_the_mock_walk_and_never_borrow_a_real_feed_id() {
        for name in ["demo", "integration"] {
            let p = Profile::load(name).unwrap();
            for l in &p.listings {
                assert!(l.is_mock_price(), "{name}/{}: localnet must not claim a source", l.key);
                assert!(l.price_account.is_empty());
                assert_eq!(l.feed_id(), Some([0u8; 32]));
            }
            assert!(p.listings.len() >= 2, "{name}: tier 2 exercises a second listing");
        }
    }

    #[test]
    fn deployed_profiles_name_the_pyth_account_their_feed_id_lives_in() {
        for name in ["devnet", "prod"] {
            let l = Profile::load(name).unwrap().primary().clone();
            assert_eq!(
                l.source,
                PriceSourceKind::Pyth,
                "{name}: a deployed desk posts a real published price"
            );
            assert!(!l.price_account.is_empty() && !l.price_rpc_url.is_empty());
            assert_ne!(l.feed_id(), Some([0u8; 32]));
        }
    }

    #[test]
    fn devnet_lists_the_prestocks_mark_under_a_label_not_a_pyth_id() {
        let p = Profile::load("devnet").unwrap();
        assert!(
            p.listing("tessera_openai").is_none(),
            "retired on 2026-09-21 (PreStocks eligibility)"
        );
        let a = p.listing("prestocks_anthropic").unwrap();
        assert_eq!(a.source, PriceSourceKind::Prestocks);
        assert_eq!(a.price_field, "markPrice");
        assert_eq!(a.implied_field, "tokenPrice", "the basis the admin serves at /marks");
        // The same vector is asserted by sdk/test/listings.test.ts.
        use sha2::Digest as _;
        assert_eq!(
            hex::encode(a.feed_id().unwrap()),
            hex::encode(sha2::Sha256::digest(b"prestocks:ANTHROPIC"))
        );
        assert!(a.haircut_bps >= 20_000, "pre-IPO marks carry a bigger haircut");
        assert_eq!(a.symbol_bytes()[..14], *b"ANTHROPIC-mock");
        assert_eq!(a.symbol_bytes()[14..], [0u8; 2]);
    }

    #[test]
    fn price_source_1_is_reserved_and_refused() {
        let mut p = Profile::load("devnet").unwrap();
        p.listings[1].source = PriceSourceKind::Reserved1;
        assert!(matches!(p.validate(), Err(ConfigError::Invalid(_))));
        assert_eq!(PriceSourceKind::Reserved1.tag(), 1);
        assert_eq!(PriceSourceKind::Prestocks.tag(), 2);
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
        let mut p = Profile::load("demo").unwrap();
        p.listings[0].haircut_bps = 15_050;
        assert!(matches!(p.validate(), Err(ConfigError::Invalid(_))));
        let mut p = Profile::load("demo").unwrap();
        p.listings[1].key = p.listings[0].key.clone();
        assert!(matches!(p.validate(), Err(ConfigError::Invalid(_))));
        let mut p = Profile::load("demo").unwrap();
        p.listings[0].price_account = "GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY".into();
        assert!(
            matches!(p.validate(), Err(ConfigError::Invalid(_))),
            "a mock never names a Pyth account"
        );
        let mut p = Profile::load("devnet").unwrap();
        p.listings[0].price_account.clear();
        assert!(matches!(p.validate(), Err(ConfigError::Invalid(_))));
        let mut p = Profile::load("devnet").unwrap();
        p.listings[1].price_field.clear();
        assert!(matches!(p.validate(), Err(ConfigError::Invalid(_))));
        let mut p = Profile::load("demo").unwrap();
        p.listings.clear();
        assert!(matches!(p.validate(), Err(ConfigError::Invalid(_))));
    }
}
