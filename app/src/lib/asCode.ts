/**
 * Renders an SDK call as the TypeScript that reproduces it, from the live arguments the app used —
 * so a developer copies exactly what ran, not an approximation. Secret material is redacted by
 * key *before* anything is rendered: the wallet signatures the ElGamal keys derive from, bid
 * openings, private keys. Those never reach the console, the clipboard or the screen.
 */
import { isAddress } from "@solana/kit";

export const SECRET_KEYS = new Set([
  "signature",
  "memberSignature",
  "tokenSignature",
  "opening",
  "loanOpening",
  "secret",
  "privateKey",
  "sk",
  "seed",
]);

const REDACTED: Record<string, string> = {
  signature: "memberSignature /* wallet signature over the member message — never logged */",
  memberSignature: "memberSignature /* wallet signature over the member message — never logged */",
  tokenSignature: "tokenSignature /* wallet signature over the token-account message — never logged */",
  opening: "opening /* Pedersen opening kept in this browser — never logged */",
  loanOpening: "opening /* Pedersen opening kept in this browser — never logged */",
};

export function hexPreview(b: ArrayLike<number>): string {
  const hex = (i: number) => (b[i] ?? 0).toString(16).padStart(2, "0");
  if (b.length <= 8) return Array.from({ length: b.length }, (_, i) => hex(i)).join("");
  return `${hex(0)}${hex(1)}${hex(2)}${hex(3)}…${hex(b.length - 2)}${hex(b.length - 1)}`;
}

function isSignerLike(v: unknown): v is { address: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "address" in v &&
    ("modifyAndSignTransactions" in v || "signTransactions" in v || "signMessages" in v || "keyPair" in v)
  );
}

export function renderValue(v: unknown, depth = 0): string {
  if (typeof v === "bigint") return `${v.toString()}n`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return isAddress(v) ? `address("${v}")` : JSON.stringify(v);
  if (typeof v === "function") return "fn";
  if (isSignerLike(v)) return "signer /* your wallet (TransactionSigner) */";
  if (v instanceof Uint8Array || ArrayBuffer.isView(v)) {
    const b = v as Uint8Array;
    return `hex("${hexPreview(b)}") /* ${b.length} bytes */`;
  }
  if (Array.isArray(v)) {
    if (v.length > 6) return `[…${v.length} items]`;
    return `[${v.map((x) => renderValue(x, depth + 1)).join(", ")}]`;
  }
  if (typeof v === "object") {
    if (depth >= 2) return "{…}";
    const entries = Object.entries(v as Record<string, unknown>);
    const pad = "  ".repeat(depth + 1);
    const inner = entries.map(([k, x]) => `${pad}${k}: ${renderField(k, x, depth + 1)},`).join("\n");
    return `{\n${inner}\n${"  ".repeat(depth)}}`;
  }
  return String(v);
}

function renderField(key: string, v: unknown, depth: number): string {
  if (SECRET_KEYS.has(key)) return REDACTED[key] ?? `${key} /* secret — never logged */`;
  return renderValue(v, depth);
}

/** `await sdk.fn({ … })`, with the live values. */
export function asCode(
  fn: string,
  args: Record<string, unknown>,
  opts: { prelude?: string; result?: string } = {},
): string {
  const body = renderValue(args, 0);
  const head = opts.prelude ? `${opts.prelude}\n` : "";
  const lhs = opts.result ? `const ${opts.result} = ` : "";
  return `${head}${lhs}await sdk.${fn}(${body});`;
}
