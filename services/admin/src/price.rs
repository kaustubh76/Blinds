//! The public price.
//!
//! On devnet and mainnet the keeper takes Pyth's quote from **Hermes** when an API key is configured
//! (`PYTH_API_KEY`; Pyth put Hermes behind a key on 2026-08-26), and otherwise — or whenever Hermes
//! fails — from Pyth's own **on-chain** `PriceUpdateV2` accounts read over RPC: the push-oracle PDAs for
//! shards 0 and 1 of the feed plus the account named in the profile, owner-checked against the Pyth
//! receiver program and feed-id-checked, the freshest `publish_time` winning. Either way the keeper posts
//! `(price, expo, publish_time)` into `PriceCache` unmodified, so the quote's own age is public.
//!
//! Why both: the mainnet push account this deployment originally read (`GpoWLTd6…`, `Crypto.TSLAX/USD`
//! shard 0) stopped being updated on 2026-09-12; a keeper that only copies one account would keep
//! re-posting a days-old quote with a fresh `posted_slot`. `Crypto.TSLAX/USD` itself is a 24/7 feed.
//!
//! The deterministic mock walk remains for localnet/CI, where there is no Pyth at all. It is only
//! ever used by a profile that also carries the documented all-zero mock feed id, so a mock price is
//! never published under a real Pyth feed id (amendment A11).

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use solana_pubkey::Pubkey;

/// Owner of every Pyth price-update account (`PriceUpdateV2`).
pub const PYTH_RECEIVER: &str = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
/// Pyth's push oracle: its PDAs `[shard u16 LE, feed_id]` are the canonical price-update accounts.
pub const PYTH_PUSH_ORACLE: &str = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";
/// Hermes base URL that honours an API key (`Authorization: Bearer`).
pub const DEFAULT_HERMES_URL: &str = "https://pyth.dourolabs.app/hermes";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Price {
    pub price: u64,
    pub expo: i32,
    pub publish_time: i64,
}

impl Price {
    /// Seconds between the feed's own timestamp and `now` (never negative).
    pub fn age_secs(&self, now: i64) -> i64 {
        now.saturating_sub(self.publish_time).max(0)
    }
}

/// Where the price comes from, decided by the profile and the environment.
pub enum Source {
    /// Hermes with an API key; `fallback` is consulted whenever the request or the parse fails.
    Hermes { base: String, key: String, feed_id: [u8; 32], fallback: Box<Source> },
    /// Pyth `PriceUpdateV2` accounts, read over RPC from `rpc_url` (may be a different cluster);
    /// the freshest of `candidates` wins.
    OnChainPyth { rpc_url: String, candidates: Vec<String>, feed_id: [u8; 32] },
    /// A public API's USD mark (PreStocks `/api/prestocks`): the element
    /// whose `match_field` equals `match_value`, read at `price_field`. An attested copy — the keeper
    /// stamps it with the fetch time — never a signed feed. The last good value is kept for the
    /// `keep_last` window so a transient 5xx does not halt the desk.
    Mark {
        name: &'static str,
        url: String,
        match_field: &'static str,
        match_value: String,
        price_field: String,
        /// The implied (traded) price field, when the API publishes one beside the mark.
        implied_field: Option<String>,
        last_ok: Option<(Price, i64)>,
        /// The last complete read: mark and implied price, for `/marks` (the basis is never on chain).
        last_read: Option<MarkRead>,
    },
    /// Deterministic walk for localnet/CI. Never used with a real feed id.
    Mock { value: u64, step: u64 },
}

/// How long a mark that stops answering is re-posted with its *old* fetch time before the keeper
/// gives up: the on-chain `max_publish_age_secs` is what finally halts locks.
const MARK_KEEP_LAST_SECS: i64 = 6 * 3600;
const MARK_RETRIES: usize = 3;

/// One read of an attested mark: what the keeper saw, in USD × 1e8, and when.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MarkRead {
    pub mark: u64,
    pub implied: Option<u64>,
    pub fetched_at: i64,
}

pub struct PriceSource {
    source: Source,
    /// Last value read, reposted when the feed itself has not moved.
    last: Option<Price>,
}

/// The push-oracle PDA holding `feed_id` on `shard`.
pub fn push_oracle_pda(shard: u16, feed_id: &[u8; 32]) -> Pubkey {
    let program: Pubkey = PYTH_PUSH_ORACLE.parse().expect("push oracle id");
    Pubkey::find_program_address(&[&shard.to_le_bytes(), feed_id], &program).0
}

impl PriceSource {
    /// Pyth's on-chain accounts: the profile's `account` (if any) plus the push-oracle PDAs for
    /// shards 0 and 1, de-duplicated. `account` may be empty.
    pub fn on_chain_pyth(rpc_url: String, account: String, feed_id: [u8; 32]) -> Self {
        let mut candidates: Vec<String> = Vec::new();
        for c in [
            account,
            push_oracle_pda(0, &feed_id).to_string(),
            push_oracle_pda(1, &feed_id).to_string(),
        ] {
            if !c.is_empty() && !candidates.contains(&c) {
                candidates.push(c);
            }
        }
        Self { source: Source::OnChainPyth { rpc_url, candidates, feed_id }, last: None }
    }

    /// Hermes first, `fallback` (normally `on_chain_pyth`) on any failure.
    pub fn hermes(base: String, key: String, feed_id: [u8; 32], fallback: PriceSource) -> Self {
        let base = base.trim_end_matches('/').to_string();
        Self {
            source: Source::Hermes { base, key, feed_id, fallback: Box::new(fallback.source) },
            last: None,
        }
    }

    /// PreStocks' public `/api/prestocks`: the element with `contract_address == source_mint`.
    pub fn prestocks(
        url: String,
        contract_address: String,
        price_field: String,
        implied_field: Option<String>,
    ) -> Self {
        Self {
            source: Source::Mark {
                name: "prestocks",
                url,
                match_field: "contract_address",
                match_value: contract_address,
                price_field,
                implied_field: implied_field.filter(|f| !f.is_empty()),
                last_ok: None,
                last_read: None,
            },
            last: None,
        }
    }

    /// The last mark read with its implied price, when this source is an attested mark.
    pub fn last_mark_read(&self) -> Option<MarkRead> {
        match &self.source {
            Source::Mark { last_read, .. } => *last_read,
            _ => None,
        }
    }

    /// The mark's public URL, when this source is an attested mark.
    pub fn mark_url(&self) -> Option<&str> {
        match &self.source {
            Source::Mark { url, .. } => Some(url),
            _ => None,
        }
    }

    pub fn mock(start_cents: u64) -> Self {
        Self { source: Source::Mock { value: start_cents * 1_000_000, step: 0 }, last: None }
    }

    /// Human-readable description of the active source, for the startup log and `/metrics`.
    pub fn describe(&self) -> String {
        describe(&self.source)
    }

    /// The current price. Errors (rather than fabricating a value) when no configured Pyth source
    /// can be read: `PriceCache` then ages out through the on-chain freshness checks, which is the
    /// honest failure mode.
    pub fn fetch(&mut self, now: i64) -> Result<Price> {
        let p = fetch(&mut self.source, now)?;
        self.last = Some(p);
        Ok(p)
    }

    pub fn last(&self) -> Option<Price> {
        self.last
    }
}

fn describe(source: &Source) -> String {
    match source {
        Source::Hermes { base, fallback, .. } => {
            format!("Pyth Hermes {base} (API key), falling back to {}", describe(fallback))
        }
        Source::OnChainPyth { candidates, rpc_url, .. } => {
            format!(
                "Pyth price-update accounts [{}] via {rpc_url} (freshest wins)",
                candidates.join(", ")
            )
        }
        Source::Mark { name, url, match_value, price_field, .. } => {
            format!("{name} mark {price_field} for {match_value} via {url} (attested, publish_time = fetch time)")
        }
        Source::Mock { .. } => "deterministic mock walk (no Pyth; localnet/CI only)".into(),
    }
}

fn fetch(source: &mut Source, now: i64) -> Result<Price> {
    match source {
        Source::Hermes { base, key, feed_id, fallback } => match fetch_hermes(base, key, feed_id) {
            Ok(p) => Ok(p),
            Err(e) => {
                tracing::warn!("hermes: {e:#}; falling back to on-chain Pyth accounts");
                fetch(fallback, now)
            }
        },
        Source::OnChainPyth { rpc_url, candidates, feed_id } => {
            let mut best: Option<Price> = None;
            let mut errors = Vec::new();
            for account in candidates.iter() {
                match fetch_account_data(rpc_url, account)
                    .and_then(|d| decode_price_update(&d, feed_id))
                {
                    Ok(p) if best.is_none_or(|b| p.publish_time > b.publish_time) => best = Some(p),
                    Ok(_) => {}
                    Err(e) => errors.push(format!("{account}: {e:#}")),
                }
            }
            best.ok_or_else(|| anyhow!("no readable Pyth account: {}", errors.join("; ")))
        }
        Source::Mark {
            name,
            url,
            match_field,
            match_value,
            price_field,
            implied_field,
            last_ok,
            last_read,
        } => {
            let mut last_err = None;
            for _ in 0..MARK_RETRIES {
                match fetch_mark(
                    url,
                    match_field,
                    match_value,
                    price_field,
                    implied_field.as_deref(),
                ) {
                    Ok((usd, implied)) => {
                        let p = Price { price: usd, expo: -8, publish_time: now };
                        *last_ok = Some((p, now));
                        *last_read = Some(MarkRead { mark: usd, implied, fetched_at: now });
                        return Ok(p);
                    }
                    Err(e) => last_err = Some(e),
                }
            }
            let err = last_err.unwrap_or_else(|| anyhow!("{name}: no attempt"));
            match last_ok {
                Some((p, at)) if now - *at <= MARK_KEEP_LAST_SECS => {
                    tracing::warn!("{name} mark: {err:#}; re-posting the last good mark from {at}");
                    Ok(*p)
                }
                _ => Err(err.context(format!("{name} mark"))),
            }
        }
        Source::Mock { value, step } => {
            // ±0.25% deterministic wobble (in hundredths of a bp) so a local demo shows a
            // moving price without ever threatening a 150%-collateralised loan.
            *step += 1;
            let wobble = ((*step * 7919) % 500) as i64 - 250;
            let px = (*value as i128 * (100_000 + wobble) as i128 / 100_000) as u64;
            Ok(Price { price: px, expo: -8, publish_time: now })
        }
    }
}

// ───────────────────────────── Hermes ─────────────────────────────

#[derive(Deserialize)]
struct HermesResponse {
    parsed: Vec<HermesParsed>,
}
#[derive(Deserialize)]
struct HermesParsed {
    id: String,
    price: HermesPrice,
}
#[derive(Deserialize)]
struct HermesPrice {
    price: String,
    expo: i32,
    publish_time: i64,
}

fn fetch_hermes(base: &str, key: &str, feed_id: &[u8; 32]) -> Result<Price> {
    let url = format!("{base}/v2/updates/price/latest?ids[]={}&parsed=true", hex::encode(feed_id));
    let body = ureq::get(&url)
        .set("Authorization", &format!("Bearer {key}"))
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .with_context(|| format!("hermes {base}"))?
        .into_string()
        .context("hermes response")?;
    parse_hermes(&body, feed_id)
}

/// `GET /v2/updates/price/latest?parsed=true` → the one feed we asked for.
pub fn parse_hermes(body: &str, expected_feed_id: &[u8; 32]) -> Result<Price> {
    let resp: HermesResponse = serde_json::from_str(body).context("hermes json")?;
    let want = hex::encode(expected_feed_id);
    let p = resp
        .parsed
        .iter()
        .find(|p| p.id.trim_start_matches("0x").eq_ignore_ascii_case(&want))
        .ok_or_else(|| anyhow!("hermes response carries no update for feed {want}"))?;
    let price: i64 = p.price.price.parse().context("hermes price is not an integer")?;
    if price <= 0 {
        bail!("Pyth published a non-positive price ({price})");
    }
    Ok(Price { price: price as u64, expo: p.price.expo, publish_time: p.price.publish_time })
}

// ───────────────────────────── attested marks ─────────────────────────────

fn fetch_mark(
    url: &str,
    match_field: &str,
    match_value: &str,
    price_field: &str,
    implied_field: Option<&str>,
) -> Result<(u64, Option<u64>)> {
    let body = ureq::get(url)
        .set("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .with_context(|| format!("mark {url}"))?
        .into_string()
        .context("mark response")?;
    let mark = parse_mark(&body, match_field, match_value, price_field)?;
    // The implied price is informational (the basis on the dashboard): its absence never blocks the mark.
    let implied = implied_field.and_then(|f| parse_mark(&body, match_field, match_value, f).ok());
    Ok((mark, implied))
}

/// A JSON array of tokens → the USD mark of the one whose `match_field` is `match_value`,
/// as an integer with `expo = −8`.
pub fn parse_mark(
    body: &str,
    match_field: &str,
    match_value: &str,
    price_field: &str,
) -> Result<u64> {
    let v: serde_json::Value = serde_json::from_str(body).context("mark json")?;
    let arr = v.as_array().ok_or_else(|| anyhow!("mark response is not an array"))?;
    let el = arr
        .iter()
        .find(|e| e.get(match_field).and_then(|m| m.as_str()) == Some(match_value))
        .ok_or_else(|| anyhow!("no element with {match_field} == {match_value}"))?;
    let usd = el
        .get(price_field)
        .and_then(|p| p.as_f64().or_else(|| p.as_str().and_then(|s| s.parse().ok())))
        .ok_or_else(|| anyhow!("{price_field} missing or not a number"))?;
    if !(usd.is_finite() && usd > 0.0 && usd < 1e9) {
        bail!("{price_field} out of range: {usd}");
    }
    Ok((usd * 1e8).round() as u64)
}

// ───────────────────────────── on-chain accounts ─────────────────────────────

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

/// `decode_price_update` plus the account's own `posted_slot` (the slot Pyth's receiver wrote it),
/// which the program's slot rule reads for a `price_source = 4` listing.
pub fn decode_price_update_slot(data: &[u8], expected_feed_id: &[u8; 32]) -> Result<(Price, u64)> {
    let price = decode_price_update(data, expected_feed_id)?;
    // The account is allocated for the 2-byte `Partial` variant, so a `Full` account carries one
    // trailing pad byte: walk the offsets rather than reading the last eight bytes.
    let off = 8 + 32 + if data[40] == 1 { 1 } else { 2 } + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8;
    let posted_slot = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    Ok((price, posted_slot))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captured from mainnet account `GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY`
    /// (Crypto.TSLAX/USD) on 2026-09-16.
    const TSLAX: &[u8] = include_bytes!("../tests/fixtures/pyth_tslax_usd_mainnet.bin");
    const TSLAX_FEED_ID: &str = "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362";
    /// The shape of `GET /v2/updates/price/latest?ids[]=…&parsed=true` for the same feed.
    const HERMES: &str = include_str!("../tests/fixtures/hermes_tslax.json");

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
        // The receiver's write slot, past the pad byte a `Full` account carries.
        let (_, posted_slot) = decode_price_update_slot(TSLAX, &feed(TSLAX_FEED_ID)).unwrap();
        assert_eq!(posted_slot, 446_427_707);
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
    fn parses_a_hermes_update_and_checks_its_feed_id() {
        let p = parse_hermes(HERMES, &feed(TSLAX_FEED_ID)).unwrap();
        assert_eq!(p.price, 36_523_000_001);
        assert_eq!(p.expo, -8);
        assert_eq!(p.publish_time, 1_789_215_534);
        assert_eq!(p.age_secs(1_789_215_600), 66);
        assert_eq!(p.age_secs(0), 0);
        let sol_usd = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
        let err = parse_hermes(HERMES, &feed(sol_usd)).unwrap_err().to_string();
        assert!(err.contains("no update for feed"), "{err}");
    }

    #[test]
    fn rejects_a_non_positive_hermes_price() {
        let body = HERMES.replace("\"36523000001\"", "\"0\"");
        assert!(parse_hermes(&body, &feed(TSLAX_FEED_ID)).is_err());
        assert!(parse_hermes("{}", &feed(TSLAX_FEED_ID)).is_err());
    }

    #[test]
    fn push_oracle_pdas_match_the_mainnet_accounts() {
        // shard 0 is the account the deployment originally read; shard 1 is where fresh equity
        // updates land on mainnet today.
        let id = feed(TSLAX_FEED_ID);
        assert_eq!(
            push_oracle_pda(0, &id).to_string(),
            "GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY"
        );
        assert_eq!(
            push_oracle_pda(1, &id).to_string(),
            "Exzs9zruUELRmPAn6SzzLiqx5wpkVJ8cghTQnF8wSCXP"
        );
        let tsla = feed("16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1");
        assert_eq!(
            push_oracle_pda(1, &tsla).to_string(),
            "FQB8c4zB8Emrp9W8bmyk6GanCLq4aRytHYPDAnaEpq9z"
        );
    }

    #[test]
    fn on_chain_candidates_are_deduplicated_and_ordered() {
        let s = PriceSource::on_chain_pyth(
            "http://rpc".into(),
            "GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY".into(),
            feed(TSLAX_FEED_ID),
        );
        let Source::OnChainPyth { candidates, .. } = &s.source else { panic!("on-chain") };
        assert_eq!(
            candidates,
            &[
                "GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY".to_string(),
                "Exzs9zruUELRmPAn6SzzLiqx5wpkVJ8cghTQnF8wSCXP".to_string()
            ]
        );
        let s = PriceSource::on_chain_pyth("http://rpc".into(), String::new(), feed(TSLAX_FEED_ID));
        let Source::OnChainPyth { candidates, .. } = &s.source else { panic!("on-chain") };
        assert_eq!(candidates.len(), 2);
        let h = PriceSource::hermes("https://h/".into(), "k".into(), feed(TSLAX_FEED_ID), s);
        assert!(h.describe().starts_with(
            "Pyth Hermes https://h (API key), falling back to Pyth price-update accounts"
        ));
    }

    const PRESTOCKS: &str = include_str!("../tests/fixtures/prestocks.json");

    #[test]
    fn a_mark_read_carries_the_implied_price_and_survives_its_absence() {
        let mark = parse_mark(
            PRESTOCKS,
            "contract_address",
            "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
            "markPrice",
        )
        .unwrap();
        let implied = parse_mark(
            PRESTOCKS,
            "contract_address",
            "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
            "tokenPrice",
        )
        .ok();
        assert!(implied.is_some_and(|i| i != mark));
        // a field the API does not publish is None, never an error for the mark
        assert!(parse_mark(
            PRESTOCKS,
            "contract_address",
            "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
            "nope"
        )
        .is_err());
        let s = PriceSource::prestocks(
            "https://p/x".into(),
            "c".into(),
            "markPrice".into(),
            Some(String::new()),
        );
        let Source::Mark { implied_field, .. } = &s.source else { panic!("mark") };
        assert!(implied_field.is_none(), "an empty implied_field means none");
        assert_eq!(s.last_mark_read(), None);
        assert_eq!(s.mark_url(), Some("https://p/x"));
    }

    #[test]
    fn parses_prestocks_marks_by_contract_address() {
        let a = parse_mark(
            PRESTOCKS,
            "contract_address",
            "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
            "markPrice",
        )
        .unwrap();
        assert_eq!(a, 100826612685); // $1008.26612685
        let implied = parse_mark(
            PRESTOCKS,
            "contract_address",
            "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
            "tokenPrice",
        )
        .unwrap();
        assert_ne!(implied, a, "tokenPrice (implied) and markPrice differ — the PreStocks basis");
        assert!(parse_mark(PRESTOCKS, "contract_address", "nope", "markPrice").is_err());
        assert_eq!(window_proofs::scalar::price_scaled(a, -8), Some(100_826));
        assert!(
            parse_mark(
                PRESTOCKS,
                "contract_address",
                "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
                "tokenPrice"
            )
            .is_ok(),
            "any positive number parses; the field name is the profile's responsibility"
        );
        assert!(parse_mark("{\"statusCode\":500}", "mint", "x", "markPrice").is_err());
        assert!(
            parse_mark("[{\"mint\":\"x\",\"markPrice\":-1}]", "mint", "x", "markPrice").is_err()
        );
    }

    #[test]
    fn a_mark_source_is_described_as_attested() {
        let s = PriceSource::prestocks(
            "https://p/x".into(),
            "c".into(),
            "markPrice".into(),
            Some("tokenPrice".into()),
        );
        assert!(s.describe().contains("attested"));
        assert!(s.describe().starts_with("prestocks mark markPrice for c"));
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
