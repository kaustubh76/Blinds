//! Everything a prover or verifier needs around the ZK ElGamal Proof program for THE WINDOW.
//!
//! * [`scalar`] — units and bounds of the priced solvency check (amendment A3). Pure integer
//!   math; compiled into `window_credit` so the on-chain scalars are literally this code.
//! * [`bid`], [`pocd`], [`solvency`] — proof builders (feature `builders`, host/wasm).
//! * [`ix`] — how proofs travel: inline (Instructions sysvar) or via context-state accounts.
//! * [`verify`] — re-checks a print or a loan from raw account data (feature `verify`).

#![cfg_attr(not(feature = "builders"), no_std)]
#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod scalar;

#[cfg(feature = "builders")]
pub mod bid;
#[cfg(feature = "builders")]
pub mod error;
#[cfg(feature = "builders")]
pub mod ix;
#[cfg(feature = "builders")]
pub mod pocd;
#[cfg(feature = "builders")]
pub mod solvency;
#[cfg(feature = "verify")]
pub mod verify;

#[cfg(feature = "builders")]
pub use error::ProofError;
