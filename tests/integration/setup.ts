/**
 * Global setup: attach to the validator started by scripts/localnet.sh (WINDOW_RPC_URL) and run
 * the real admin service (administrator + keeper + operator + price poster) and the simulated
 * agents for the duration of the suite — the same binaries the demo and devnet use.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const ADMIN = process.env.WINDOW_ADMIN_BIN ?? resolve(ROOT, "target/release/window-admin");
export const ADMIN_PORT = Number(process.env.WINDOW_ADMIN_PORT ?? 9091);

let admin: ChildProcess | undefined;
let agents: ChildProcess | undefined;

function run(args: string[], log: string): ChildProcess {
  const child = spawn(ADMIN, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      WINDOW_CLUSTER: "localnet",
      WINDOW_PROFILE: process.env.WINDOW_PROFILE ?? "integration",
      // No WINDOW_PRICE_TICK_MS or WINDOW_ADMIN_TICK_MS here on purpose. Both were pinned by hand
      // after the two failures they name — the price cache stale for 8 s of every 20 (24 Sep), and
      // the administrator unable to reach the repay window at all (25–30 Sep). The service now
      // sizes both clocks from the profile itself (`services/admin/src/cadence.rs`), and while a
      // pin stands nothing exercises that: this suite is the only thing that would catch the clamp
      // being wrong again, and it cannot while it overrides the clamp.
      WINDOW_AUDITOR_SEED_HEX:
        process.env.WINDOW_AUDITOR_SEED_HEX ?? "1111111111111111111111111111111111111111111111111111111111111111",
      RUST_LOG: process.env.RUST_LOG ?? "info",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `[${log}] `;
  const pipe = (d: Buffer) =>
    process.stdout.write(`${prefix}${d.toString().replaceAll("\n", `\n${prefix}`).trimEnd()}\n`);
  child.stdout?.on("data", pipe);
  child.stderr?.on("data", pipe);
  return child;
}

export async function setup() {
  if (!existsSync(ADMIN)) throw new Error(`${ADMIN} missing — run \`cargo build -p window-admin --release\``);
  if (process.env.WINDOW_ATTACH_SERVICES === "1") return;
  admin = run(["run", "--tick-ms", "1500", "--metrics-port", String(ADMIN_PORT), "--default-every", "0"], "admin");
  agents = run(["agents", "--tick-ms", "2000"], "agents");
  const url = `http://127.0.0.1:${ADMIN_PORT}/healthz`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("admin service did not come up");
}

export async function teardown() {
  admin?.kill("SIGTERM");
  agents?.kill("SIGTERM");
}
