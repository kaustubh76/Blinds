//! The quote a listing prices from, read the way the program reads it: the keeper's `PriceCache`
//! for sources 0–3, Pyth's own receiver-owned `PriceUpdateV2` for source 4. The agents pre-check
//! freshness here so they never spend proof-context rent on a lock the chain would refuse.

use anyhow::{bail, Result};
use window_client::{PriceCache, PYTH_RECEIVER};

use crate::{
    chain::{read, Chain},
    deployment::ListingRecord,
    price::decode_price_update_slot,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quote {
    pub price: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub posted_slot: u64,
}

impl Quote {
    /// Whether the program would accept this quote right now, under the listing's two rules.
    pub fn usable(&self, rec: &ListingRecord, now: i64, slot: u64) -> bool {
        now.saturating_sub(self.publish_time) <= rec.max_publish_age_secs
            && slot.saturating_sub(self.posted_slot) <= rec.max_price_age_slots
    }
}

/// `None` when the account does not exist yet.
pub fn read_quote(chain: &dyn Chain, rec: &ListingRecord) -> Result<Option<Quote>> {
    if rec.reads_pyth_account() {
        let key = rec.quote_account()?;
        let Some((owner, data)) = chain.account_owner_and_data(&key)? else {
            return Ok(None);
        };
        if owner != PYTH_RECEIVER {
            bail!("{key} is not owned by the Pyth receiver");
        }
        let (p, posted_slot) = decode_price_update_slot(&data, &rec.feed_id())?;
        return Ok(Some(Quote {
            price: p.price,
            expo: p.expo,
            publish_time: p.publish_time,
            posted_slot,
        }));
    }
    Ok(read::<PriceCache>(chain, &rec.quote_account()?)?.map(|c| Quote {
        price: c.price,
        expo: c.expo,
        publish_time: c.publish_time,
        posted_slot: c.posted_slot,
    }))
}
