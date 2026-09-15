/**
 * The one component through which ciphertexts reach the screen. It shows bytes, never a number,
 * unless the owner's browser has decrypted the value with the wallet-derived key (`plaintext`),
 * in which case the number is labelled as a local decryption.
 */
import { hex } from "../lib/format";

export function EncryptedValue({
  bytes,
  plaintext,
  label,
}: {
  bytes: ArrayLike<number>;
  /** Owner-side decryption; only ever computed in this browser. */
  plaintext?: string | null;
  label?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs text-mute" title={hex(bytes)}>
        {label ? `${label} ` : ""}
        {hex(bytes, 16)}
      </span>
      {plaintext != null && (
        <span
          className="rounded border border-accent/40 px-1.5 text-xs text-accent"
          title="decrypted locally with your wallet key"
        >
          {plaintext}
        </span>
      )}
    </span>
  );
}
