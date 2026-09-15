/**
 * Key derivation contract shared with the Rust side (`window_elgamal::keys`) and Token-2022
 * tooling: a wallet signs `"solana-conf-bal/v1" ‖ public_seed`; the 64-byte signature is the IKM
 * of an HKDF-SHA512 that yields the ElGamal and AE keys. Secrets never leave the browser.
 */
const enc = new TextEncoder();
export const HKDF_SALT = enc.encode("solana-conf-bal/v1");
/** Public seed of a member's auction key (bids, loans, collateral claims). */
export const MEMBER_KEY_SEED = enc.encode("thewindow:member:v1");

export function signingMessage(publicSeed: Uint8Array): Uint8Array {
  const out = new Uint8Array(HKDF_SALT.length + publicSeed.length);
  out.set(HKDF_SALT);
  out.set(publicSeed, HKDF_SALT.length);
  return out;
}
/** The message a member signs once per session to derive its auction key. */
export const memberSigningMessage = () => signingMessage(MEMBER_KEY_SEED);
/** The message for a confidential token account's keys (seed = the account address bytes). */
export const tokenAccountSigningMessage = (accountAddressBytes: Uint8Array) => signingMessage(accountAddressBytes);
