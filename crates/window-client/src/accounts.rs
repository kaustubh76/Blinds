//! Decoding of program accounts from raw data.

use anchor_lang::AccountDeserialize;

use crate::{Epoch, Print};

/// Anchor discriminator + borsh body.
pub fn decode<T: AccountDeserialize>(data: &[u8]) -> Option<T> {
    T::try_deserialize(&mut &data[..]).ok()
}

/// Zero-copy `Epoch` (8-byte discriminator, then the Pod struct).
pub fn decode_epoch(data: &[u8]) -> Option<Epoch> {
    (data.len() >= Epoch::SPACE).then(|| *bytemuck::from_bytes::<Epoch>(&data[8..Epoch::SPACE]))
}

/// Zero-copy `Print`.
pub fn decode_print(data: &[u8]) -> Option<Print> {
    (data.len() >= Print::SPACE).then(|| *bytemuck::from_bytes::<Print>(&data[8..Print::SPACE]))
}

/// The 8-byte Anchor discriminator of an account type, for `getProgramAccounts` memcmp filters.
pub fn discriminator<T: anchor_lang::Discriminator>() -> [u8; 8] {
    let d = T::DISCRIMINATOR;
    let mut out = [0u8; 8];
    out.copy_from_slice(&d[..8]);
    out
}
