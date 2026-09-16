/* tslint:disable */
/* eslint-disable */

/**
 * Bid proofs for `size` micro-USDC (as a decimal string) with minimum `s_min`.
 */
export function bid_proofs(signature: Uint8Array, auditor_pubkey: Uint8Array, size: string, s_min: string): any;

/**
 * Whether a 64-byte ciphertext under the member's key encrypts `expected`.
 */
export function ciphertext_equals(signature: Uint8Array, ciphertext: Uint8Array, expected: string): boolean;

/**
 * Decrypts a confidential balance view: `(available, pending)` from the account's extension bytes
 * (`decryptable_available_balance` 36 B, `pending_lo` 64 B, `pending_hi` 64 B).
 */
export function confidential_balances(signature: Uint8Array, decryptable: Uint8Array, pending_lo: Uint8Array, pending_hi: Uint8Array): any;

/**
 * Recovers the plaintext of a member-key ciphertext below `max` (small values only; BSGS 2^16 table).
 */
export function decrypt_small(signature: Uint8Array, ciphertext: Uint8Array, max: string): string | undefined;

/**
 * ElGamal public key (32 bytes) derived from a 64-byte wallet signature.
 */
export function elgamal_pubkey_from_signature(signature: Uint8Array): Uint8Array;

/**
 * New decryptable balance ciphertext (36 B) for `ApplyPendingBalance` / after a transfer.
 */
export function encrypt_balance(signature: Uint8Array, amount: string): Uint8Array;

/**
 * The four proofs of a lock. `loan_ciphertext` is the loan's 96-byte grouped ciphertext,
 * `loan_opening` its 32-byte opening (own bid, or the sealed note opened with `open_note`).
 */
export function lock_proofs(signature: Uint8Array, auditor_pubkey: Uint8Array, shares_milli: string, loan_ciphertext: Uint8Array, loan_size: string, loan_opening: Uint8Array, price_cents: string, mult_scaled: string, haircut_bps: string): any;

/**
 * Opens a partial-fill opening note sealed by the administrator (ECDH with the auditor key).
 */
export function open_note(signature: Uint8Array, auditor_pubkey: Uint8Array, note: Uint8Array, loan_address: Uint8Array): Uint8Array;

/**
 * The message a wallet signs to derive its confidential keys (`"solana-conf-bal/v1" ‖ seed`).
 */
export function signing_message(seed: Uint8Array): Uint8Array;

export function start(): void;

/**
 * Keys for a confidential token account derived from the wallet's signature over
 * `signing_message(token_account_address)`: returns `elgamal_pubkey ‖ pubkey_validity_proof_data`.
 */
export function token_account_keys(signature: Uint8Array): any;

/**
 * Proofs for a confidential transfer: equality (161 B ctx / data 320 B), ciphertext validity
 * (3 handles, batched), and a u128 range proof, plus the auditor ciphertext lo/hi for the
 * instruction and the new source decryptable balance.
 */
export function transfer_proofs(signature: Uint8Array, available_ct: Uint8Array, decryptable: Uint8Array, amount: string, destination_elgamal_pubkey: Uint8Array, auditor_pubkey: Uint8Array): any;

/**
 * Re-verifies a print from raw account data: `epoch` (Epoch account data), `print` (Print account
 * data) and the concatenated 192-byte PoCD proof data blobs extracted from the attest transactions.
 */
export function verify_print(epoch_data: Uint8Array, print_data: Uint8Array, proofs: Uint8Array): any;

/**
 * Proofs for a confidential withdraw (equality + u64 range) and the new decryptable balance.
 */
export function withdraw_proofs(signature: Uint8Array, available_ct: Uint8Array, decryptable: Uint8Array, amount: string): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly bid_proofs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly ciphertext_equals: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly confidential_balances: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly decrypt_small: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly elgamal_pubkey_from_signature: (a: number, b: number) => [number, number, number, number];
    readonly encrypt_balance: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly lock_proofs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number];
    readonly open_note: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly signing_message: (a: number, b: number) => [number, number];
    readonly start: () => void;
    readonly token_account_keys: (a: number, b: number) => [number, number, number];
    readonly transfer_proofs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly verify_print: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly withdraw_proofs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
