//! Every numeric instruction argument, account field and event field in the five IDLs must be on
//! an explicit allow-list. A size can therefore never be added to the on-chain surface silently.
use std::{collections::BTreeSet, path::PathBuf};

use serde_json::Value;

const NUMERIC: &[&str] =
    &["u8", "u16", "u32", "u64", "u128", "i8", "i16", "i32", "i64", "i128", "f32", "f64"];

/// (program, item kind, item name, field name) — what is allowed to be a number and why.
const ALLOW: &[(&str, &str, &str, &str)] = &[
    // registry
    ("window_registry", "ix", "add_member", "joined_epoch"),
    ("window_registry", "account", "Config", "member_count"),
    ("window_registry", "account", "Config", "bump"),
    ("window_registry", "account", "Member", "joined_epoch"),
    ("window_registry", "account", "Member", "bump"),
    ("window_registry", "event", "MemberAdded", "joined_epoch"),
    // auction: slots, ticks, counts, config parameters, the public minimum size
    ("window_auction", "type", "InitializeParams", "epoch_slots"),
    ("window_auction", "type", "InitializeParams", "keeper_grace_slots"),
    ("window_auction", "type", "InitializeParams", "stale_after_slots"),
    ("window_auction", "type", "InitializeParams", "s_min"),
    ("window_auction", "type", "InitializeParams", "max_bids_per_epoch"),
    ("window_auction", "ix", "close_epoch", "index"),
    ("window_auction", "ix", "submit_bid", "side"),
    ("window_auction", "ix", "submit_bid", "tick"),
    ("window_auction", "ix", "mark_printed", "index"),
    ("window_auction", "ix", "mark_printed", "outcome"),
    ("window_auction", "account", "Config", "epoch_slots"),
    ("window_auction", "account", "Config", "keeper_grace_slots"),
    ("window_auction", "account", "Config", "stale_after_slots"),
    ("window_auction", "account", "Config", "s_min"),
    ("window_auction", "account", "Config", "max_bids_per_epoch"),
    ("window_auction", "account", "Config", "epochs_opened"),
    ("window_auction", "account", "Config", "current_epoch"),
    ("window_auction", "account", "Config", "bump"),
    ("window_auction", "account", "Epoch", "index"),
    ("window_auction", "account", "Epoch", "start_slot"),
    ("window_auction", "account", "Epoch", "close_slot"),
    ("window_auction", "account", "Epoch", "bid_count"),
    ("window_auction", "account", "Epoch", "total_bids"),
    ("window_auction", "account", "Epoch", "status"),
    ("window_auction", "account", "Epoch", "bump"),
    ("window_auction", "account", "Bid", "epoch"),
    ("window_auction", "account", "Bid", "side"),
    ("window_auction", "account", "Bid", "tick"),
    ("window_auction", "account", "Bid", "slot"),
    ("window_auction", "account", "Bid", "bump"),
    ("window_auction", "event", "EpochOpened", "index"),
    ("window_auction", "event", "EpochOpened", "start_slot"),
    ("window_auction", "event", "EpochClosed", "index"),
    ("window_auction", "event", "EpochClosed", "close_slot"),
    ("window_auction", "event", "BidSubmitted", "epoch"),
    ("window_auction", "event", "BidSubmitted", "side"),
    ("window_auction", "event", "BidSubmitted", "tick"),
    ("window_auction", "event", "EpochPrinted", "index"),
    ("window_auction", "event", "EpochPrinted", "outcome"),
    ("window_auction", "event", "AuditorRotated", "epochs_opened"),
    // oracle: proven aggregates and regime state
    ("window_oracle", "ix", "initialize", "band_edge_epochs"),
    ("window_oracle", "ix", "initialize", "stale_after_slots"),
    ("window_oracle", "ix", "begin_print", "epoch_index"),
    ("window_oracle", "ix", "attest_ticks", "epoch_index"),
    ("window_oracle", "ix", "finalize_print", "epoch_index"),
    ("window_oracle", "ix", "finalize_print", "claimed_r_star"),
    ("window_oracle", "ix", "mark_stale", "epoch_index"),
    ("window_oracle", "type", "TickClaim", "side"),
    ("window_oracle", "type", "TickClaim", "tick"),
    ("window_oracle", "type", "TickClaim", "sum"), // a per-tick aggregate, proven
    ("window_oracle", "account", "OracleState", "band_edge_epochs"),
    ("window_oracle", "account", "OracleState", "stale_after_slots"),
    ("window_oracle", "account", "OracleState", "last_print_epoch"),
    ("window_oracle", "account", "OracleState", "last_r_star_tick"),
    ("window_oracle", "account", "OracleState", "last_matched"),
    ("window_oracle", "account", "OracleState", "stale"),
    ("window_oracle", "account", "OracleState", "consecutive_trades"),
    ("window_oracle", "account", "OracleState", "edge_streak"),
    ("window_oracle", "account", "OracleState", "interior_streak"),
    ("window_oracle", "account", "OracleState", "band_edge"),
    ("window_oracle", "account", "OracleState", "tau"),
    ("window_oracle", "account", "OracleState", "prints"),
    ("window_oracle", "account", "OracleState", "bump"),
    ("window_oracle", "account", "Print", "epoch"),
    ("window_oracle", "account", "Print", "claimed_sum"),
    ("window_oracle", "account", "Print", "matched_volume"),
    ("window_oracle", "account", "Print", "marginal_ratio_num"),
    ("window_oracle", "account", "Print", "marginal_ratio_den"),
    ("window_oracle", "account", "Print", "finalized_slot"),
    ("window_oracle", "account", "Print", "matches_posted"),
    ("window_oracle", "account", "Print", "tau"),
    ("window_oracle", "account", "Print", "attested"),
    ("window_oracle", "account", "Print", "status"),
    ("window_oracle", "account", "Print", "missed"),
    ("window_oracle", "account", "Print", "r_star_tick"),
    ("window_oracle", "account", "Print", "marginal_tick"),
    ("window_oracle", "account", "Print", "stale"),
    ("window_oracle", "account", "Print", "regime_flags"),
    ("window_oracle", "account", "Print", "bump"),
    ("window_oracle", "event", "PrintBegun", "epoch"),
    ("window_oracle", "event", "PrintBegun", "nonzero_ticks"),
    ("window_oracle", "event", "TicksAttested", "epoch"),
    ("window_oracle", "event", "TicksAttested", "attested"),
    ("window_oracle", "event", "Printed", "epoch"),
    ("window_oracle", "event", "Printed", "r_star_tick"),
    ("window_oracle", "event", "Printed", "r_star_bps"),
    ("window_oracle", "event", "Printed", "matched_volume"),
    ("window_oracle", "event", "Printed", "tau"),
    ("window_oracle", "event", "NoTrade", "epoch"),
    ("window_oracle", "event", "NoTrade", "tau"),
    ("window_oracle", "event", "PrintMissed", "epoch"),
    ("window_oracle", "event", "PrintMissed", "tau"),
    // wrap: the public token leg (documented in the leak budget)
    ("window_wrap", "ix", "wrap", "amount"),
    ("window_wrap", "ix", "unwrap", "amount"),
    ("window_wrap", "account", "Vault", "wrapped"),
    ("window_wrap", "account", "Vault", "decimals"),
    ("window_wrap", "account", "Vault", "bump"),
    ("window_wrap", "account", "Vault", "mint_authority_bump"),
    // credit: public price/scalars/slots/statuses
    ("window_credit", "type", "InitializeParams", "haircut_bps"),
    ("window_credit", "type", "InitializeParams", "max_price_age"),
    ("window_credit", "type", "InitializeParams", "tenor_slots"),
    ("window_credit", "type", "InitializeParams", "multiplier_override"),
    ("window_credit", "ix", "post_price", "price"),
    ("window_credit", "ix", "post_price", "expo"),
    ("window_credit", "ix", "post_price", "publish_time"),
    ("window_credit", "ix", "post_match", "epoch"),
    ("window_credit", "ix", "post_match", "k"),
    ("window_credit", "account", "Config", "haircut_bps"),
    ("window_credit", "account", "Config", "max_price_age"),
    ("window_credit", "account", "Config", "tenor_slots"),
    ("window_credit", "account", "Config", "multiplier_override"),
    ("window_credit", "account", "Config", "bump"),
    ("window_credit", "account", "PriceCache", "price"),
    ("window_credit", "account", "PriceCache", "expo"),
    ("window_credit", "account", "PriceCache", "publish_time"),
    ("window_credit", "account", "PriceCache", "posted_slot"),
    ("window_credit", "account", "PriceCache", "posts"),
    ("window_credit", "account", "PriceCache", "bump"),
    ("window_credit", "account", "Loan", "epoch"),
    ("window_credit", "account", "Loan", "tick"),
    ("window_credit", "account", "Loan", "bid_tick"),
    ("window_credit", "account", "Loan", "k"),
    ("window_credit", "account", "Loan", "status"),
    ("window_credit", "account", "Loan", "fill_num"),
    ("window_credit", "account", "Loan", "fill_den"),
    ("window_credit", "account", "Loan", "k_c"),
    ("window_credit", "account", "Loan", "k_l"),
    ("window_credit", "account", "Loan", "price_at_lock"),
    ("window_credit", "account", "Loan", "mult_at_lock"),
    ("window_credit", "account", "Loan", "lock_slot"),
    ("window_credit", "account", "Loan", "funded_slot"),
    ("window_credit", "account", "Loan", "deadline_slot"),
    ("window_credit", "account", "Loan", "bump"),
    ("window_credit", "event", "PricePosted", "price"),
    ("window_credit", "event", "PricePosted", "expo"),
    ("window_credit", "event", "PricePosted", "publish_time"),
    ("window_credit", "event", "MatchPosted", "epoch"),
    ("window_credit", "event", "MatchPosted", "tick"),
    ("window_credit", "event", "LockRequested", "price_at_lock"),
    ("window_credit", "event", "LockRequested", "mult_at_lock"),
    ("window_credit", "event", "LoanStatusChanged", "status"),
];

/// Ciphertext-bearing fields must be fixed byte arrays, never numbers or vectors.
const CIPHERTEXT_FIELDS: &[(&str, &str, usize)] = &[
    ("Bid", "ciphertext", 96),
    ("Loan", "size_ct", 96),
    ("Loan", "collateral_ct", 96),
    ("Loan", "delta_commitment", 32),
];

fn idl(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../target/idl/{name}.json"));
    serde_json::from_str(
        &std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display())),
    )
    .unwrap()
}

/// Numbers, and containers of numbers (`[u64; 37]`, `Vec<u32>`, `Option<u8>`) — a size could hide
/// inside any of them. Byte arrays (`[u8; N]`, ciphertexts) are not numeric surfaces.
fn is_numeric(ty: &Value) -> bool {
    if let Some(s) = ty.as_str() {
        return NUMERIC.contains(&s);
    }
    if let Some(inner) = ty.get("option").or_else(|| ty.get("vec")) {
        return is_numeric(inner);
    }
    if let Some(arr) = ty.get("array").and_then(|a| a.as_array()) {
        let elem = &arr[0];
        if elem.as_str() == Some("u8") {
            return false;
        }
        return is_numeric(elem);
    }
    false
}

fn fields_of(defined: &Value) -> Vec<(String, Value)> {
    defined["type"]["fields"]
        .as_array()
        .map(|fs| {
            fs.iter()
                .map(|f| (f["name"].as_str().unwrap().to_string(), f["type"].clone()))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn every_numeric_surface_is_allow_listed() {
    // Keyed by (item, field): an account embedded in another program's IDL (e.g. `Member` in the
    // auction IDL) is the same surface, not a new one.
    let allow: BTreeSet<_> = ALLOW.iter().map(|(_, _, i, f)| format!("{i}/{f}")).collect();
    let mut seen = BTreeSet::new();
    let mut violations = Vec::new();
    for program in
        ["window_registry", "window_auction", "window_oracle", "window_wrap", "window_credit"]
    {
        let idl = idl(program);
        for ix in idl["instructions"].as_array().unwrap() {
            for arg in ix["args"].as_array().unwrap() {
                if is_numeric(&arg["type"]) {
                    let key = format!(
                        "{}/{}",
                        ix["name"].as_str().unwrap(),
                        arg["name"].as_str().unwrap()
                    );
                    seen.insert(key.clone());
                    if !allow.contains(&key) {
                        violations.push(key);
                    }
                }
            }
        }
        let account_names: BTreeSet<String> = idl["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["name"].as_str().unwrap().to_string())
            .collect();
        let event_names: BTreeSet<String> = idl["events"]
            .as_array()
            .map(|e| e.iter().map(|a| a["name"].as_str().unwrap().to_string()).collect())
            .unwrap_or_default();
        for t in idl["types"].as_array().unwrap() {
            // Foreign types are qualified (`window_auction::state::Config`); use the bare name.
            let name = t["name"].as_str().unwrap().rsplit("::").next().unwrap();
            let kind = if account_names.contains(name) {
                "account"
            } else if event_names.contains(name) {
                "event"
            } else {
                "type"
            };
            for (field, ty) in fields_of(t) {
                if is_numeric(&ty) {
                    let key = format!("{name}/{field}");
                    let _ = kind;
                    seen.insert(key.clone());
                    if !allow.contains(&key) {
                        violations.push(key);
                    }
                }
                if let Some((_, _, len)) =
                    CIPHERTEXT_FIELDS.iter().find(|(n, f, _)| *n == name && *f == field)
                {
                    assert_eq!(ty["array"][0], "u8", "{name}.{field} must be bytes");
                    assert_eq!(ty["array"][1], *len as u64, "{name}.{field} length");
                }
            }
        }
    }
    assert!(
        violations.is_empty(),
        "numeric fields not on the allow-list (a size leaking?):\n{}",
        violations.join("\n")
    );
    // The allow-list must not rot either: every entry must exist.
    let stale: Vec<_> = allow.difference(&seen).cloned().collect();
    assert!(stale.is_empty(), "allow-list entries that no longer exist:\n{}", stale.join("\n"));
}
