import type { Plugin } from "vite";

export interface BridgeParamSpec {
  kind: "int" | "choice";
  min?: number;
  max?: number;
  choices?: string[];
  default: string | number;
}

export interface BridgeCommand {
  id: string;
  label: string;
  blurb: string;
  spends?: "localnet" | "devnet" | "mainnet";
  params: Record<string, BridgeParamSpec>;
  /** The same command as a line you could type yourself. */
  command: string;
  runnable: boolean;
  /** Environment names the command needs and cannot find (e.g. `CLAWPUMP_API_KEY`). */
  missing: string[];
  needsBuild?: string;
}

export declare const COMMANDS: readonly { id: string; label: string; blurb: string }[];
/** Each command as a line you could type, with its defaults filled in — keyed by id. */
export declare function commandLines(): Record<
  string,
  { label: string; blurb: string; command: string; spends?: string }
>;
export declare function scrub(line: string, secrets?: string[]): string;
export declare function validate(
  cmd: { params?: Record<string, BridgeParamSpec> },
  raw: Record<string, unknown> | undefined,
): { values: Record<string, string | number>; error?: undefined } | { error: string; values?: undefined };
export declare function devBridge(): Plugin;
