//! The public price: Pyth Hermes for the named 24/7 feed, or a documented mock random walk when
//! no feed is configured / reachable (localnet, CI). Either way it is *public* and *attested*:
//! `PriceCache` records feed id, publish time and posting slot for anyone to compare.

use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Copy)]
pub struct Price {
    pub price: u64,
    pub expo: i32,
    pub publish_time: i64,
}

#[derive(Deserialize)]
struct Hermes {
    parsed: Vec<HermesParsed>,
}
#[derive(Deserialize)]
struct HermesParsed {
    price: HermesPrice,
}
#[derive(Deserialize)]
struct HermesPrice {
    price: String,
    expo: i32,
    publish_time: i64,
}

pub struct PriceSource {
    pub hermes_url: Option<String>,
    pub feed_id_hex: String,
    mock: u64,
    step: u64,
}

impl PriceSource {
    pub fn new(hermes_url: Option<String>, feed_id_hex: String, mock_start_cents: u64) -> Self {
        Self { hermes_url, feed_id_hex, mock: mock_start_cents * 1_000_000, step: 0 }
    }

    /// Hermes if configured; otherwise a deterministic mock walk (expo −8).
    pub fn fetch(&mut self, now: i64) -> Result<Price> {
        if let Some(url) = &self.hermes_url {
            if !self.feed_id_hex.is_empty() && self.feed_id_hex != "0".repeat(64) {
                let full = format!("{url}/v2/updates/price/latest?ids[]={}", self.feed_id_hex);
                if let Ok(resp) = ureq::get(&full).timeout(std::time::Duration::from_secs(5)).call()
                {
                    if let Ok(h) = resp.into_json::<Hermes>() {
                        if let Some(p) = h.parsed.first() {
                            if let Ok(price) = p.price.price.parse::<u64>() {
                                return Ok(Price {
                                    price,
                                    expo: p.price.expo,
                                    publish_time: p.price.publish_time,
                                });
                            }
                        }
                    }
                }
                tracing::warn!("hermes unreachable or malformed; using mock walk");
            }
        }
        // ±0.25% deterministic wobble around the start so the demo shows a moving price.
        self.step += 1;
        let wobble = ((self.step * 7919) % 500) as i64 - 250; // bp/100
        let px = (self.mock as i128 * (10_000 + wobble) as i128 / 10_000) as u64;
        Ok(Price { price: px, expo: -8, publish_time: now })
    }
}
