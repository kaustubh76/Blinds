//! The price a listing is marked with, read from either of two accounts:
//!
//! * sources 0–3: this program's own `PriceCache` PDA `["price", listing.feed_id]`, written by the
//!   keeper (`post_price`);
//! * source 4 (`PRICE_SOURCE_PYTH_ACCOUNT`): a `PriceUpdateV2` account owned by the **Pyth
//!   receiver** program — the price Pyth's guardians signed, posted on this cluster by anyone
//!   (the desk's poster), verified by the receiver, never touched by the keeper. The checks are
//!   the ones Pyth documents for consumers: owner, feed id, verification level, and — done by the
//!   caller with the same rules as the cache — age.

use anchor_lang::prelude::*;

use crate::{
    errors::CreditError,
    seeds,
    state::{Listing, PriceCache, PRICE_SOURCE_PYTH_ACCOUNT},
};

/// `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` — the Pyth receiver, owner of every `PriceUpdateV2`.
pub const PYTH_RECEIVER: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

pub struct Quote {
    pub price: u64,
    pub expo: i32,
    pub publish_time: i64,
    /// The slot the quote was posted in — by the keeper (cache) or by the receiver (Pyth).
    pub posted_slot: u64,
}

pub fn read_quote(listing: &Listing, account: &AccountInfo) -> Result<Quote> {
    if listing.price_source == PRICE_SOURCE_PYTH_ACCOUNT {
        require_keys_eq!(*account.owner, PYTH_RECEIVER, CreditError::BadPriceAccount);
        let data = account.try_borrow_data()?;
        decode_price_update(&data, &listing.feed_id)
    } else {
        require_keys_eq!(*account.owner, crate::ID, CreditError::BadPriceAccount);
        let (expected, _) =
            Pubkey::find_program_address(&[seeds::PRICE, listing.feed_id.as_ref()], &crate::ID);
        require_keys_eq!(*account.key, expected, CreditError::BadPriceAccount);
        let data = account.try_borrow_data()?;
        let cache = PriceCache::try_deserialize(&mut &data[..])
            .map_err(|_| error!(CreditError::BadPriceAccount))?;
        Ok(Quote {
            price: cache.price,
            expo: cache.expo,
            publish_time: cache.publish_time,
            posted_slot: cache.posted_slot,
        })
    }
}

/// Pyth `PriceUpdateV2`:
/// `disc(8) ‖ write_authority(32) ‖ verification_level ‖ feed_id(32) ‖ price i64 ‖ conf u64 ‖
///  expo i32 ‖ publish_time i64 ‖ prev_publish_time i64 ‖ ema_price i64 ‖ ema_conf u64 ‖ posted_slot u64`.
/// `verification_level` is a Borsh enum: `Partial{num_signatures: u8}` = 2 bytes, `Full` = 1 byte.
/// Only a fully verified update marks collateral.
pub fn decode_price_update(data: &[u8], expected_feed_id: &[u8; 32]) -> Result<Quote> {
    let mut off = 8 + 32;
    let tag = *data.get(off).ok_or(CreditError::BadPriceAccount)?;
    require!(tag == 1, CreditError::BadPriceAccount); // Full
    off += 1;
    let end = off + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8;
    require!(data.len() >= end, CreditError::BadPriceAccount);
    require!(&data[off..off + 32] == expected_feed_id, CreditError::WrongFeed);
    off += 32;
    let price = i64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    off += 8 + 8; // price, conf
    let expo = i32::from_le_bytes(data[off..off + 4].try_into().unwrap());
    off += 4;
    let publish_time = i64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    off += 8 + 8 + 8 + 8; // publish_time, prev_publish_time, ema_price, ema_conf
    let posted_slot = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
    require!(price > 0, CreditError::BadPrice);
    Ok(Quote { price: price as u64, expo, publish_time, posted_slot })
}
