//! The off-chain half of THE WINDOW (spec v2 §8): the Benchmark Administrator (decrypt
//! aggregates, prove, print, match), the keeper (epoch clock, price, seize), the operator
//! (escrow) and the simulated agents — one binary, one disclosed key, roles kept in separate
//! modules so they can be split later.
//!
//! Privacy rule of this crate: decrypted quantities are `Secret<u64>` and never reach a log.

pub mod administrator;
pub mod agents;
pub mod chain;
pub mod deployment;
pub mod faucet;
pub mod keeper;
pub mod keys;
pub mod matching;
pub mod metrics;
pub mod migrate;
pub mod operator;
pub mod price;
pub mod secret;
pub mod setup;

pub use chain::{Chain, RpcChain};
pub use deployment::Deployment;
pub use secret::Secret;

/// Everything a role needs per tick.
pub struct Ctx {
    pub chain: Box<dyn Chain>,
    pub keys: keys::Keys,
    pub profile: window_config::Profile,
    pub deployment: Deployment,
    pub metrics: std::sync::Arc<metrics::Metrics>,
    /// How many recent epochs the administrator re-scans each tick (late prints, restarts).
    pub backfill_epochs: usize,
    /// Demo policy: every n-th loan is left to default (0 = never).
    pub default_every: usize,
}
