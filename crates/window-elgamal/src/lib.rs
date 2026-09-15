//! Twisted ElGamal over Ristretto, exactly as Token-2022 Confidential Transfers use it, with the
//! three operations THE WINDOW adds on top: homomorphic accumulation of bids, the residual
//! ciphertext a proof-of-correct-decryption is made over, and the priced solvency delta.
//!
//! The core (`point`, `ciphertext`, `solvency`) is built on `solana_curve25519`, which is dalek on
//! the host and syscalls on SBF behind one API — so the same function bodies run in the programs,
//! the administrator, the tests and (via wasm) the dashboard. Byte layouts are identical to
//! `solana_zk_sdk`'s pod types and are checked by tests.

#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod ciphertext;
pub mod point;
pub mod solvency;

#[cfg(feature = "std")]
pub mod bsgs;
#[cfg(feature = "std")]
pub mod decrypt;
#[cfg(feature = "std")]
pub mod encrypt;
#[cfg(feature = "std")]
pub mod keys;

pub use ciphertext::{Accumulator, Ciphertext, GroupedCiphertext2, GroupedCiphertext3};
pub use point::{CurveError, Point, Scalar32, BASEPOINT};
pub use solvency::{shifted_commitment, solvency_delta};
