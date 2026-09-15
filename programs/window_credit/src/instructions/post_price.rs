use anchor_lang::prelude::*;

use crate::{
    errors::CreditError,
    events::PricePosted,
    seeds,
    state::{Config, PriceCache},
};

#[derive(Accounts)]
pub struct PostPrice<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [seeds::CONFIG], bump = config.bump, has_one = keeper @ CreditError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = keeper,
        space = 8 + PriceCache::INIT_SPACE,
        seeds = [seeds::PRICE, config.feed_id.as_ref()],
        bump
    )]
    pub price_cache: Account<'info, PriceCache>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(
    ctx: Context<PostPrice>,
    price: u64,
    expo: i32,
    publish_time: i64,
) -> Result<()> {
    require!(price > 0, CreditError::BadPrice);
    let cache = &mut ctx.accounts.price_cache;
    if cache.posts > 0 {
        require!(publish_time >= cache.publish_time, CreditError::PriceRegressed);
    }
    cache.feed_id = ctx.accounts.config.feed_id;
    cache.price = price;
    cache.expo = expo;
    cache.publish_time = publish_time;
    cache.posted_slot = Clock::get()?.slot;
    cache.posts = cache.posts.saturating_add(1);
    cache.bump = ctx.bumps.price_cache;
    emit!(PricePosted { feed_id: cache.feed_id, price, expo, publish_time });
    Ok(())
}
