use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("signer is not the registry admin")]
    Unauthorized,
    #[msg("ElGamal public key must not be all zeroes")]
    ZeroKey,
    #[msg("member is not active")]
    NotActive,
}
