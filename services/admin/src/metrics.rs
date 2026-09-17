//! `/healthz` and `/metrics` (Prometheus text). Aggregates only — never a size.

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

#[derive(Default)]
pub struct Metrics {
    pub epochs_opened: AtomicU64,
    pub epochs_closed: AtomicU64,
    pub prints: AtomicU64,
    pub print_txs: AtomicU64,
    pub print_failures: AtomicU64,
    pub matches_posted: AtomicU64,
    pub locks_confirmed: AtomicU64,
    pub releases: AtomicU64,
    pub seizes: AtomicU64,
    pub prices_posted: AtomicU64,
    /// Age of the last posted quote by its own `publish_time`, seconds — the worst listing.
    pub price_publish_age_secs: AtomicU64,
    /// The same, per listing symbol.
    pub price_publish_age_by_listing: std::sync::Mutex<std::collections::BTreeMap<String, u64>>,
    pub bids_closed: AtomicU64,
    pub keeper_lamports: AtomicU64,
    pub last_print_ms: AtomicU64,
    pub last_r_star_bps: AtomicU64,
}

impl Metrics {
    pub fn set_publish_age(&self, listing: &str, age: u64) {
        if let Ok(mut m) = self.price_publish_age_by_listing.lock() {
            m.insert(listing.to_string(), age);
            let worst = m.values().copied().max().unwrap_or(age);
            self.price_publish_age_secs.store(worst, Ordering::Relaxed);
        }
    }

    pub fn render(&self) -> String {
        let f = |n: &str, v: &AtomicU64| format!("window_{n} {}\n", v.load(Ordering::Relaxed));
        let per_listing: String = self
            .price_publish_age_by_listing
            .lock()
            .map(|m| {
                m.iter()
                    .map(|(k, v)| {
                        format!("window_price_publish_age_seconds{{listing=\"{k}\"}} {v}\n")
                    })
                    .collect()
            })
            .unwrap_or_default();
        [
            f("epochs_opened_total", &self.epochs_opened),
            f("epochs_closed_total", &self.epochs_closed),
            f("prints_total", &self.prints),
            f("bids_closed_total", &self.bids_closed),
            f("print_transactions_total", &self.print_txs),
            f("print_failures_total", &self.print_failures),
            f("matches_posted_total", &self.matches_posted),
            f("locks_confirmed_total", &self.locks_confirmed),
            f("releases_total", &self.releases),
            f("seizes_total", &self.seizes),
            f("prices_posted_total", &self.prices_posted),
            f("price_publish_age_seconds", &self.price_publish_age_secs),
            per_listing,
            f("keeper_lamports", &self.keeper_lamports),
            f("last_print_wallclock_ms", &self.last_print_ms),
            f("last_r_star_bps", &self.last_r_star_bps),
        ]
        .concat()
    }
}

/// A request the dashboard makes on behalf of a judge's wallet: register it as a member and give
/// it mock stock (the demo faucet). Admission is admin-gated on-chain; this is the admin.
pub struct JoinRequest {
    pub wallet: String,
    pub elgamal_pubkey_hex: String,
    pub mock_account: String,
}

/// What `/join` did: a transaction for a new member, or nothing for one already admitted.
pub struct JoinOutcome {
    pub signature: Option<String>,
    pub already_member: bool,
}

/// Why `/join` refused: a bad request (400), the hourly cap (429), the balance floor (503).
pub enum JoinRefusal {
    Bad(String),
    Busy { retry_after_secs: u64 },
    Broke,
}

pub type JoinHandler = Arc<dyn Fn(JoinRequest) -> Result<JoinOutcome, JoinRefusal> + Send + Sync>;

/// `GET /faucet`: what the limiter has left.
pub type FaucetStatus = Arc<dyn Fn() -> String + Send + Sync>;

/// Serves `/healthz`, `/metrics`, `/deployment` (JSON), `/faucet` and `POST /join` on `port`.
pub fn serve(
    metrics: Arc<Metrics>,
    port: u16,
    deployment_json: String,
    join: Option<JoinHandler>,
    faucet: Option<FaucetStatus>,
) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("0.0.0.0", port)) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("metrics server not started: {e}");
                return;
            }
        };
        for mut req in server.incoming_requests() {
            let cors = tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
            let cors_h =
                tiny_http::Header::from_bytes("Access-Control-Allow-Headers", "content-type")
                    .unwrap();
            let cors_m =
                tiny_http::Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                    .unwrap();
            if req.method() == &tiny_http::Method::Options {
                let _ = req.respond(
                    tiny_http::Response::empty(204)
                        .with_header(cors)
                        .with_header(cors_h)
                        .with_header(cors_m),
                );
                continue;
            }
            let (status, body, ctype) = match (req.method().clone(), req.url()) {
                (tiny_http::Method::Get, "/healthz") => (200, "ok\n".to_string(), "text/plain"),
                (tiny_http::Method::Get, "/metrics") => (200, metrics.render(), "text/plain"),
                (tiny_http::Method::Get, "/deployment") => {
                    (200, deployment_json.clone(), "application/json")
                }
                (tiny_http::Method::Get, "/faucet") => match &faucet {
                    Some(f) => (200, f(), "application/json"),
                    None => (
                        404,
                        "{\"ok\":false,\"error\":\"no faucet\"}".to_string(),
                        "application/json",
                    ),
                },
                (tiny_http::Method::Post, "/join") => {
                    let mut body = String::new();
                    let _ = req.as_reader().read_to_string(&mut body);
                    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
                    match (parsed, &join) {
                        (Ok(v), Some(h)) => {
                            let r = JoinRequest {
                                wallet: v["wallet"].as_str().unwrap_or_default().to_string(),
                                elgamal_pubkey_hex: v["elgamal_pubkey_hex"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .to_string(),
                                mock_account: v["mock_account"]
                                    .as_str()
                                    .unwrap_or_default()
                                    .to_string(),
                            };
                            match h(r) {
                                Ok(o) => (
                                    200,
                                    format!(
                                        "{{\"ok\":true,\"signature\":{},\"already_member\":{}}}",
                                        serde_json::to_string(&o.signature).unwrap_or_default(),
                                        o.already_member
                                    ),
                                    "application/json",
                                ),
                                Err(JoinRefusal::Bad(e)) => (
                                    400,
                                    format!(
                                        "{{\"ok\":false,\"error\":{}}}",
                                        serde_json::to_string(&e).unwrap_or_default()
                                    ),
                                    "application/json",
                                ),
                                Err(JoinRefusal::Busy { retry_after_secs }) => (
                                    429,
                                    format!(
                                        "{{\"ok\":false,\"error\":\"faucet busy: the hourly cap is reached, retry in {retry_after_secs} s\",\"retry_after_secs\":{retry_after_secs}}}"
                                    ),
                                    "application/json",
                                ),
                                Err(JoinRefusal::Broke) => (
                                    503,
                                    "{\"ok\":false,\"error\":\"faucet paused: the admin balance is below its floor\"}".to_string(),
                                    "application/json",
                                ),
                            }
                        }
                        _ => (
                            400,
                            "{\"ok\":false,\"error\":\"bad request\"}".to_string(),
                            "application/json",
                        ),
                    }
                }
                _ => (404, "not found\n".to_string(), "text/plain"),
            };
            let resp = tiny_http::Response::from_string(body)
                .with_status_code(status)
                .with_header(tiny_http::Header::from_bytes("Content-Type", ctype).unwrap())
                .with_header(cors);
            let _ = req.respond(resp);
        }
    });
}
