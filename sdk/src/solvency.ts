/**
 * Priced-solvency scalars (amendment A3), mirroring `crates/window-proofs/src/scalar.rs`:
 * `k_c = p′·a`, `k_l = haircut_bps / 100`; the check is `c·k_c ≥ ℓ·k_l` over the ciphertexts.
 */
export const COLLATERAL_BITS = 32;
export const BID_BITS = 40;
const SCALAR_BOUND_BITS = 63n;

export interface SolvencyScalars {
  kC: bigint;
  kL: bigint;
}

/** `price × 10^(expo+2)`: the price in cents (`p′`). */
export function priceCents(price: bigint, expo: number): bigint {
  const e = expo + 2;
  return e >= 0 ? price * 10n ** BigInt(e) : price / 10n ** BigInt(-e);
}

/** `round(multiplier × 10^3)` (`a`). */
export function multiplierScaled(multiplier: number): bigint {
  if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("multiplier must be positive");
  return BigInt(Math.floor(multiplier * 1_000 + 0.5));
}

export function solvencyScalars(priceCentsValue: bigint, multScaled: bigint, haircutBps: bigint): SolvencyScalars {
  if (haircutBps % 100n !== 0n || haircutBps < 10_000n || priceCentsValue === 0n || multScaled === 0n)
    throw new Error("invalid solvency parameters");
  const s = { kC: priceCentsValue * multScaled, kL: haircutBps / 100n };
  if (!scalarBoundOk(s)) throw new Error("scalar bound exceeded");
  return s;
}

export function scalarBoundOk(s: SolvencyScalars): boolean {
  return (
    s.kC << BigInt(COLLATERAL_BITS) < 1n << SCALAR_BOUND_BITS && s.kL << BigInt(BID_BITS) < 1n << SCALAR_BOUND_BITS
  );
}

/** Minimum milli-shares such that `c·k_c ≥ ℓ·k_l`. */
export function collateralRequired(loanMicroUsdc: bigint, s: SolvencyScalars): bigint {
  return (loanMicroUsdc * s.kL + s.kC - 1n) / s.kC;
}

/** The desk's pledge policy: 160% of the requirement, so a small price move does not strand the loan. */
export function collateralPledge(loanMicroUsdc: bigint, s: SolvencyScalars): bigint {
  return (loanMicroUsdc * s.kL * 16n) / 10n / s.kC + 1n;
}
