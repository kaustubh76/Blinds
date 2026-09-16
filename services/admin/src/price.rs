//! The public price.
//!
//! On devnet and mainnet the keeper reads Pyth's own **on-chain** price-update account over RPC —
//! no API key, no off-chain endpoint — verifies that the account is owned by the Pyth receiver
//! program and that the `feed_id` inside it is the one this deployment is configured for, and posts
//! `(price, expo, publish_time)` into `PriceCache`. Anyone can read the same account and compare.
//!
//! Pyth's public Hermes HTTP API started returning `401 unauthorized` for price updates
//! (2026-09-16), which is why the value is taken from chain state instead (amendment A11).
//!
//! The deterministic mock walk remains for localnet/CI, where there is no Pyth at all. It is only
//! ever used by a profile that also carries the documented all-zero mock feed id, so a mock price is
//! never published under a real Pyth feed id.

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;

/// Owner of every Pyth price-update account (`PriceUpdateV2`).
pub const PYTH_RECEIVER: &str = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Price {
    pub price: u64,
    pub expo: i32,
    pub publish_time: i64,
}

/// Where the price comes from, decided by the profile.
pub enum Source {
    /// Pyth `PriceUpdateV2` account, read over RPC from `rpc_url` (may be a different cluster).
    OnChainPyth { rpc_url: String, account: String, feed_id: [u8; 32] },
    /// Deterministic walk for localnet/CI. Never used with a real feed id.
    Mock { value: u64, step: u64 },
}

pub struct PriceSource {
    source: Source,
    /// Last value read, reposted when the feed itself has not moved (equities close overnight).
    last: Option<Price>,
}

impl PriceSource {
    pub fn on_chain_pyth(rpc_url: String, account: String, feed_id: [u8; 32]) -> Self {
        Self { source: Source::OnChainPyth { rpc_url, account, feed_id }, last: None }
    }

    pub fn mock(start_cents: u64) -> Self {
        Self { source: Source::Mock { value: start_cents * 1_000_000, step: 0 }, last: None }
    }

    /// Human-readable description of the active source, for the startup log and `/metrics`.
    pub fn describe(&self) -> String {
        match &self.source {
            Source::OnChainPyth { account, rpc_url, .. } => {
                format!("Pyth price-update account {account} via {rpc_url}")
            }
            Source::Mock { .. } => "deterministic mock walk (no Pyth; localnet/CI only)".into(),
        }
    }

    /// The current price. Errors (rather than fabricating a value) when a configured Pyth account
    /// cannot be read: `PriceCache` then ages out through the on-chain `max_price_age` check, which
    /// is the honest failure mode.
    pub fn fetch(&mut self, now: i64) -> Result<Price> {
        match &mut self.source {
            Source::OnChainPyth { rpc_url, account, feed_id } => {
                let data = fetch_account_data(rpc_url, account)?;
                let p = decode_price_update(&data, feed_id)?;
                self.last = Some(p);
                Ok(p)
            }
            Source::Mock { value, step } => {
                // ±0.25% deterministic wobble (in hundredths of a bp) so a local demo shows a
                // moving price without ever threatening a 150%-collateralised loan.
                *step += 1;
                let wobble = ((*step * 7919) % 500) as i64 - 250;
                let px = (*value as i128 * (100_000 + wobble) as i128 / 100_000) as u64;
                let p = Price { price: px, expo: -8, publish_time: now };
                self.last = Some(p);
                Ok(p)
            }
        }
    }

    pub fn last(&self) -> Option<Price> {
        self.last
    }
}

#[derive(Deserialize)]
struct RpcResponse {
    result: Option<RpcResult>,
    error: Option<serde_json::Value>,
}
#[derive(Deserialize)]
struct RpcResult {
    value: Option<RpcAccount>,
}
#[derive(Deserialize)]
struct RpcAccount {
    data: (String, String),
    owner: String,
}

/// `getAccountInfo(account, {encoding: base64})`, owner-checked against the Pyth receiver.
fn fetch_account_data(rpc_url: &str, account: &str) -> Result<Vec<u8>> {
    use base64::Engine as _;
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
        "params": [account, {"encoding": "base64", "commitment": "confirmed"}],
    });
    let resp: RpcResponse = ureq::post(rpc_url)
        .timeout(std::time::Duration::from_secs(10))
        .send_json(body)
        .with_context(|| format!("price rpc {rpc_url}"))?
        .into_json()
        .context("price rpc response")?;
    if let Some(e) = resp.error {
        bail!("price rpc error: {e}");
    }
    let acc = resp
        .result
        .and_then(|r| r.value)
        .ok_or_else(|| anyhow!("price account {account} not found on {rpc_url}"))?;
    if acc.owner != PYTH_RECEIVER {
        bail!("price account {account} is owned by {}, not the Pyth receiver", acc.owner);
    }
    base64::engine::general_purpose::STANDARD.decode(acc.data.0).context("price account data")
}

/// Pyth `PriceUpdateV2`:
/// `disc(8) ‖ write_authority(32) ‖ verification_level ‖ feed_id(32) ‖ price i64 ‖ conf u64 ‖
///  expo i32 ‖ publish_time i64 ‖ prev_publish_time i64 ‖ ema_price i64 ‖ ema_conf u64 ‖ slot u64`.
/// `verification_level` is a Borsh enum: `Partial{num_signatures: u8}` = 2 bytes, `Full` = 1 byte.
pub fn decode_price_update(data: &[u8], expected_feed_id: &[u8; 32]) -> Result<Price> {
    let mut off = 8 + 32;
    let tag = *data.get(off).ok_or_else(|| anyhow!("price account too short"))?;
    off += match tag {
        0 => 2, // Partial { num_signatures }
        1 => 1, // Full
        t => bail!("unknown Pyth verification level {t}"),
    };
    let end = off + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8;
    if data.len() < end {
        bail!("price account too short: {} bytes", data.len());
    }
    let feed_id: [u8; 32] = data[off..off + 32].try_into().unwrap();
    if &feed_id != expected_feed_id {
        bail!(
            "price account carries feed {} but this deployment is configured for {}",
            hex::encode(feed_id),
            hex::encode(expected_feed_id)
        );
    }
    off += 32;
    let price = i64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    off += 8 + 8; // price, conf
    let expo = i32::from_le_bytes(data[off..off + 4].try_into().unwrap());
    off += 4;
    let publish_time = i64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    if price <= 0 {
        bail!("Pyth published a non-positive price ({price})");
    }
    Ok(Price { price: price as u64, expo, publish_time })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captured from mainnet account `GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY`
    /// (Crypto.TSLAX/USD) on 2026-09-16.
    const TSLAX: &[u8] = include_bytes!("../tests/fixtures/pyth_tslax_usd_mainnet.bin");
    const TSLAX_FEED_ID: &str = "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362";

    fn feed(hex_id: &str) -> [u8; 32] {
        hex::decode(hex_id).unwrap().try_into().unwrap()
    }

    #[test]
    fn decodes_the_mainnet_tslax_price_update_account() {
        let p = decode_price_update(TSLAX, &feed(TSLAX_FEED_ID)).unwrap();
        assert_eq!(p.price, 36_523_000_001);
        assert_eq!(p.expo, -8);
        assert_eq!(p.publish_time, 1_789_215_534);
        // §7.3 / A3: p′ = price · 10^(expo+2) = the price in cents.
        assert_eq!(window_proofs::scalar::price_scaled(p.price, p.expo), Some(36_523));
    }

    #[test]
    fn rejects_an_account_for_a_different_feed() {
        let sol_usd = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
        let err = decode_price_update(TSLAX, &feed(sol_usd)).unwrap_err().to_string();
        assert!(err.contains("configured for"), "{err}");
    }

    #[test]
    fn rejects_truncated_data() {
        assert!(decode_price_update(&TSLAX[..40], &feed(TSLAX_FEED_ID)).is_err());
    }

    #[test]
    fn the_mock_walk_moves_and_stays_near_its_start() {
        let mut s = PriceSource::mock(40_012);
        let first = s.fetch(0).unwrap();
        let second = s.fetch(1).unwrap();
        assert_ne!(first.price, second.price);
        for _ in 0..50 {
            let p = s.fetch(2).unwrap();
            let drift = (p.price as i128 - 40_012_000_000i128).abs() * 10_000 / 40_012_000_000i128;
            assert!(drift <= 25, "mock walk drifted {drift} bp");
        }
    }
}
