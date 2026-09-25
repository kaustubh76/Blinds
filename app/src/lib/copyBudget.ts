/**
 * The copy budget, enforced mechanically.
 *
 * Every fact on a page is a line you can scan; anything that needs a paragraph to be fair is written
 * once in `docs/` and linked with `DocLink`. This module is the rule, and `copyBudget.test.ts` scans
 * every source file under `src/` against it — the same arrangement as `honestClaims.ts`, so a
 * paragraph creeping back in fails `pnpm test` rather than quietly shipping.
 *
 * What is deliberately *not* measured: block comments (the house writes long ones, and a reader of
 * the UI never sees them), `className` strings, and the `code:` snippets in `features/build/recipes.ts`
 * — those are TypeScript samples a developer copies, and they are supposed to be long.
 */

/** The most characters a rendered run of prose may carry. */
export const MAX_RUN = 180;
/** Above this a run is worth a second look, even if it passes. Used for reporting, not failing. */
export const WATCH_RUN = 120;

/**
 * Whether a run is prose a reader sees, rather than code the extractor swept up.
 *
 * The extraction below is regex over source, so the discriminator has to be strict: a single `=`, `;`,
 * brace, quote or backtick means a fragment of TypeScript was caught between a `>` and a `<` (type
 * generics and arrow functions are full of both). Prose in this codebase carries none of them.
 */
export function isProse(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  // Any of these means code, not copy.
  if (/[=;{}"`\\]|=>|\breturn\b|\bconst\b|\blet\b|\bimport\b|\bexport\b|\bfunction\b|\/\//.test(t)) return false;
  // Two consecutive lowercase words is the cheapest reliable signal of a sentence.
  if (!/[a-z]{2,}\s+[a-z]{2,}/.test(t)) return false;
  // A bare URL or a lone long identifier is not prose.
  if (/^https?:\/\//.test(t)) return false;
  // Tailwind and other token lists: hyphenated or slashed tokens, and no sentence punctuation.
  if (/^[a-z0-9:_\-\s/[\]().%#]+$/.test(t) && /[-/:]/.test(t) && !/[.,;—·]/.test(t) && t.split(/\s+/).length > 6)
    return false;
  return true;
}

export interface Offender {
  text: string;
  length: number;
}

/**
 * Every prose run in a source file that exceeds `max`.
 *
 * Deliberately crude, and deliberately biased toward missing a run rather than inventing one: a guard
 * that cries wolf gets deleted. It reads JSX text nodes and the string/template literals that sit in a
 * copy slot, then lets `isProse` throw out everything that is really code.
 */
export function overBudget(source: string, max = MAX_RUN): Offender[] {
  // Strip what a reader never sees, longest constructs first.
  let s = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
  s = s.replace(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g, " ");
  // `code:` and `<Snippet>`/`<Code>` bodies are TypeScript samples by contract, not copy.
  s = s.replace(/\bcode:\s*\([^)]*\)\s*=>\s*`[\s\S]*?`,/g, " ");
  s = s.replace(/<(Snippet|Code)[^>]*>\{?`[\s\S]*?`\}?<\/(Snippet|Code)>/g, " ");

  const runs: string[] = [];
  // A JSX text node: between tags, on its own, with no interpolation left in it.
  for (const m of s.matchAll(/>\s*\n?([^<>]{40,})</g)) runs.push((m[1] as string).replace(/\{" "\}/g, " "));
  // A string or template literal in a copy slot.
  const SLOT = /(?:footer|lead|blurb|detail|hint|text|title|role|label|note|placeholder)\s*[:=]\s*\{?\s*/;
  for (const m of s.matchAll(new RegExp(`${SLOT.source}"((?:[^"\\\\\n]|\\\\.){40,})"`, "g"))) runs.push(m[1] as string);
  for (const m of s.matchAll(new RegExp(`${SLOT.source}\`([^\`]{40,})\``, "g")))
    runs.push((m[1] as string).replace(/\$\{[^}]*\}/g, "x"));

  const seen = new Set<string>();
  const out: Offender[] = [];
  for (const raw of runs) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (text.length <= max || seen.has(text) || !isProse(text)) continue;
    seen.add(text);
    out.push({ text, length: text.length });
  }
  return out.sort((a, b) => b.length - a.length);
}
