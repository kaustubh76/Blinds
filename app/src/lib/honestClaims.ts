/**
 * Spec §14 honest-claims rule, enforced mechanically: the dashboard never describes the desk with
 * these words. The test scans every source file under `src/`.
 */
export const FORBIDDEN_CLAIMS = [
  "trustless",
  "undecryptable",
  "nobody can see",
  "fully anonymous",
  "unhackable",
] as const;

export function findForbiddenClaims(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_CLAIMS.filter((c) => lower.includes(c));
}
