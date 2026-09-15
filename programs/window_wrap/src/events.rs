use anchor_lang::prelude::*;

/// No amount: the token leg is public by nature; the event does not repeat it.
#[event]
pub struct Wrapped {
    pub member: Pubkey,
}

#[event]
pub struct Unwrapped {
    pub member: Pubkey,
}
