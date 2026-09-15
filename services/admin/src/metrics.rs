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
    pub keeper_lamports: AtomicU64,
    pub last_print_ms: AtomicU64,
    pub last_r_star_bps: AtomicU64,
}

impl Metrics {
    pub fn render(&self) -> String {
        let f = |n: &str, v: &AtomicU64| format!("window_{n} {}\n", v.load(Ordering::Relaxed));
        [
            f("epochs_opened_total", &self.epochs_opened),
            f("epochs_closed_total", &self.epochs_closed),
            f("prints_total", &self.prints),
            f("print_transactions_total", &self.print_txs),
            f("print_failures_total", &self.print_failures),
            f("matches_posted_total", &self.matches_posted),
            f("locks_confirmed_total", &self.locks_confirmed),
            f("releases_total", &self.releases),
            f("seizes_total", &self.seizes),
            f("prices_posted_total", &self.prices_posted),
            f("keeper_lamports", &self.keeper_lamports),
            f("last_print_wallclock_ms", &self.last_print_ms),
            f("last_r_star_bps", &self.last_r_star_bps),
        ]
        .concat()
    }
}

/// Serves `/healthz` and `/metrics` on `port` from a background thread.
pub fn serve(metrics: Arc<Metrics>, port: u16) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("0.0.0.0", port)) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("metrics server not started: {e}");
                return;
            }
        };
        for req in server.incoming_requests() {
            let body = match req.url() {
                "/healthz" => "ok\n".to_string(),
                "/metrics" => metrics.render(),
                _ => "not found\n".to_string(),
            };
            let _ = req.respond(tiny_http::Response::from_string(body));
        }
    });
}
