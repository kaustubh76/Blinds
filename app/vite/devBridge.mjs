/**
 * The dev bridge: a Vite dev-server endpoint that runs one of a fixed list of this repo's own
 * commands and streams its output back to the page. It exists so the Agent page's journey steps are
 * buttons on the machine that has the repo checked out, instead of sentences telling you to go and
 * type something.
 *
 * `apply: "serve"` — it cannot end up in a build, so on the hosted site the probe 404s and the page
 * falls back to showing the command with a copy button. That difference is stated on the page.
 *
 * It spawns processes, so:
 *   · the command is chosen from an allow-list by id; nothing from the request becomes a program name
 *   · `shell: false`, and every argument is validated against the command's own spec
 *   · anything that spends money is refused unless WINDOW_DEV_BRIDGE_ALLOW_SPEND=1
 *   · the child's output is scrubbed before it leaves this process — the repo's `.env` carries a
 *     Clawpump API key and the auditor seed, and neither may reach a browser tab
 *   · cross-origin requests cannot reach it: JSON content-type is required (which forces a preflight
 *     we never answer) and a mismatched Origin is refused
 *   · one command at a time
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ADMIN_BIN = join(ROOT, "target", "release", "window-admin");
const CLUSTERS = ["localnet", "devnet"];

/** `pnpm --filter @thewindow/launch <script> …` */
const launch = (script, ...rest) => ["pnpm", ["--filter", "@thewindow/launch", script, ...rest]];
/** `window-admin --cluster <c> --profile demo <sub>` — always explicit, because `.env` sets devnet. */
const admin = (sub, cluster) => [ADMIN_BIN, ["--cluster", cluster, "--profile", "demo", sub]];

/**
 * Every command the bridge will run. `spends` is the cluster whose money it costs; a command with
 * one is refused unless spending is enabled. `blurb` is what the page shows next to the button.
 */
export const COMMANDS = [
  {
    id: "launch-plan",
    label: "Price the curve",
    blurb: "Reads Pyth for the quote stock and writes the launch plan — the numbers the pool is configured from.",
    argv: () => launch("plan"),
    needs: [],
  },
  {
    id: "launch-status",
    label: "Read the pool",
    blurb: "Progress, raised against the threshold, spot and the fees accrued to the agent.",
    argv: () => launch("status"),
    needs: [],
  },
  {
    id: "launch-preflight",
    label: "Preflight the launch",
    blurb: "Every check the launch makes — balance, quote age, config — and sends nothing.",
    argv: () => launch("launch", "--", "--dry-run"),
    needs: [],
  },
  {
    id: "launch-buy",
    label: "Buy into the curve",
    blurb: "Swaps quote units into the pool's token, which moves the curve and the fee period.",
    argv: ({ amount }) => launch("buy", "--", String(amount)),
    params: { amount: { kind: "int", min: 1, max: 1000, default: 5 } },
    spends: "devnet",
    needs: [],
  },
  {
    id: "launch-create",
    label: "Create the pool",
    blurb: "createConfigAndPool: the pool mints its token. About 0.03 SOL plus rents.",
    argv: () => launch("launch"),
    spends: "devnet",
    needs: [],
  },
  {
    id: "launch-graduate",
    label: "Graduate",
    blurb: "Metadata, then migrate to DAMM v2 with the LP locked for good.",
    argv: () => launch("graduate"),
    spends: "devnet",
    needs: [],
  },
  {
    id: "agent-status",
    label: "What Clawpump reports",
    blurb: "Reads the agent back from Clawpump: name, status, wallet, whether it is public.",
    argv: () => launch("agent-status"),
    needs: ["CLAWPUMP_API_KEY"],
  },
  {
    id: "agent-upsert",
    label: "Give the agent its identity",
    blurb: "Reuses and renames the key's agent, sets the avatar, makes it public, and starts it.",
    argv: () => launch("agent"),
    needs: ["CLAWPUMP_API_KEY"],
  },
  {
    id: "clawpump-preflight",
    label: "Preflight the identity coin",
    blurb: "Checks the pair is listed and the agent wallet is funded. Launches nothing.",
    argv: () => launch("clawpump-launch", "--", "--preflight"),
    needs: ["CLAWPUMP_API_KEY"],
  },
  {
    id: "clawpump-launch",
    label: "Launch the identity coin",
    blurb: "Clawpump launches the coin on pump.fun paired with TSLAx. The agent's own wallet pays ~0.0092 SOL.",
    argv: () => launch("clawpump-launch"),
    spends: "mainnet",
    needs: ["CLAWPUMP_API_KEY"],
  },
  {
    id: "admin-price-check",
    label: "What the chain would accept",
    blurb: "Per listing: the mark on chain, its age, and whether lock & seize would be accepted right now.",
    argv: ({ cluster }) => admin("price-check", cluster),
    params: { cluster: { kind: "choice", choices: CLUSTERS, default: "localnet" } },
    needs: [],
    binary: ADMIN_BIN,
  },
  {
    id: "admin-zk-probe",
    label: "Probe the ZK program",
    blurb: "Asks the ZK ElGamal proof program to verify one proof of each kind this desk relies on.",
    argv: ({ cluster }) => admin("zk-probe", cluster),
    params: { cluster: { kind: "choice", choices: CLUSTERS, default: "localnet" } },
    needs: [],
    binary: ADMIN_BIN,
  },
  {
    id: "admin-listings-sync",
    label: "Sync the collateral schedule",
    blurb: "Pushes config/demo.toml's listings on chain: adds what is missing, updates what changed.",
    argv: ({ cluster }) => admin("listings-sync", cluster),
    params: { cluster: { kind: "choice", choices: CLUSTERS, default: "localnet" } },
    spends: "localnet",
    needs: [],
    binary: ADMIN_BIN,
  },
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

/** `KEY=value` lines from the repo's `.env`, so a spawned command sees what a shell would give it. */
function repoEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * What must never reach the browser. The API key and the auditor seed are the named ones; the
 * catch-alls cover a command that prints a key or a keypair path we have not thought of.
 */
export function scrub(line, secrets = []) {
  let s = String(line);
  for (const v of secrets) if (v && v.length >= 8) s = s.split(v).join("«redacted»");
  return s
    .replace(/\bcpk_[A-Za-z0-9_-]{8,}/g, "cpk_«redacted»")
    .replace(/\b[0-9a-fA-F]{64}\b/g, "«64 hex redacted»")
    .replace(/(\/[^\s'"]*(?:id\.json|-keypair\.json))/g, "«keypair path»")
    .replace(/(\/[^\s'"]*\.config\/solana\/[^\s'"]*)/g, "«keypair path»");
}

/** Validates the request's args against the command's spec. Returns `{ values }` or `{ error }`. */
export function validate(cmd, raw) {
  const values = {};
  for (const [key, spec] of Object.entries(cmd.params ?? {})) {
    const given = raw?.[key];
    if (spec.kind === "int") {
      const n = Number(given ?? spec.default);
      if (!Number.isInteger(n) || n < spec.min || n > spec.max)
        return { error: `${key} must be a whole number between ${spec.min} and ${spec.max}` };
      values[key] = n;
    } else {
      const v = String(given ?? spec.default);
      if (!spec.choices.includes(v)) return { error: `${key} must be one of ${spec.choices.join(", ")}` };
      values[key] = v;
    }
  }
  return { values };
}

const TIMEOUT_MS = 10 * 60_000;
let busy = null;

/**
 * Each command as a line you could type yourself, with its defaults filled in. Exported because the
 * page needs these strings even where there is no bridge — a hosted visitor is shown the command
 * instead of a button — and a test asserts the copy in `app/src/lib/devBridge.ts` still agrees.
 */
export function commandLines() {
  const out = {};
  for (const c of COMMANDS) {
    const [file, args] = c.argv(Object.fromEntries(Object.entries(c.params ?? {}).map(([k, sp]) => [k, sp.default])));
    out[c.id] = {
      label: c.label,
      blurb: c.blurb,
      command: [file === ADMIN_BIN ? "./target/release/window-admin" : file, ...args].join(" "),
      ...(c.spends ? { spends: c.spends } : {}),
    };
  }
  return out;
}

/** The catalogue the page reads, without the argv builders. */
function catalogue(spendAllowed) {
  const lines = commandLines();
  return COMMANDS.map((c) => ({
    id: c.id,
    label: c.label,
    blurb: c.blurb,
    ...(c.spends ? { spends: c.spends } : {}),
    params: c.params ?? {},
    command: lines[c.id].command,
    runnable: !c.spends || spendAllowed,
    missing: (c.needs ?? []).filter((k) => !repoEnv()[k] && !process.env[k]),
    ...(c.binary && !existsSync(c.binary) ? { needsBuild: "cargo build -p window-admin --release" } : {}),
  }));
}

export function devBridge() {
  return {
    name: "window-dev-bridge",
    apply: "serve",
    configureServer(server) {
      const spendAllowed = process.env.WINDOW_DEV_BRIDGE_ALLOW_SPEND === "1";

      server.middlewares.use("/__dev/bridge", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            root: ROOT,
            spendAllowed,
            spendFlag: "WINDOW_DEV_BRIDGE_ALLOW_SPEND=1",
            commands: catalogue(spendAllowed),
          }),
        );
      });

      server.middlewares.use("/__dev/run", (req, res) => {
        const fail = (code, error) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: false, error }));
        };
        if (req.method !== "POST") return fail(405, "POST only");
        // A page on another origin cannot set this content-type without a preflight, which is never
        // answered — so this is the CSRF guard as much as it is a parser hint.
        if (!/application\/json/i.test(req.headers["content-type"] ?? "")) return fail(415, "send JSON");
        const origin = req.headers.origin;
        if (origin && req.headers.host && !origin.endsWith(req.headers.host)) return fail(403, "cross-origin refused");
        if (busy) return fail(409, `already running ${busy}`);

        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > 4096) req.destroy();
        });
        req.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            return fail(400, "malformed JSON");
          }
          const cmd = byId.get(parsed.id);
          if (!cmd) return fail(404, `no such command: ${String(parsed.id).slice(0, 40)}`);
          if (cmd.spends && !spendAllowed)
            return fail(
              403,
              `${cmd.id} spends ${cmd.spends} funds. Restart the dev server with WINDOW_DEV_BRIDGE_ALLOW_SPEND=1 if you mean it.`,
            );
          const { values, error } = validate(cmd, parsed.args);
          if (error) return fail(400, error);
          if (cmd.binary && !existsSync(cmd.binary))
            return fail(412, `${cmd.binary} is not built: cargo build -p window-admin --release`);

          const [file, args] = cmd.argv(values);
          const env = { ...repoEnv(), ...process.env };
          const secrets = Object.entries(repoEnv())
            .filter(([k]) => /KEY|SEED|SECRET|TOKEN|PASSWORD/i.test(k))
            .map(([, v]) => v);

          busy = cmd.id;
          res.statusCode = 200;
          res.setHeader("content-type", "application/x-ndjson");
          res.setHeader("cache-control", "no-store");
          const send = (o) => res.write(`${JSON.stringify(o)}\n`);
          send({ stream: "start", id: cmd.id, command: [file, ...args].join(" "), at: Date.now() });

          const child = spawn(file, args, { cwd: ROOT, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
          const killer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
          const pipe = (stream, name) => {
            let buf = "";
            stream.setEncoding("utf8");
            stream.on("data", (chunk) => {
              buf += chunk;
              const lines = buf.split("\n");
              buf = lines.pop() ?? "";
              for (const l of lines) send({ stream: name, line: scrub(l, secrets) });
            });
            stream.on("end", () => {
              if (buf) send({ stream: name, line: scrub(buf, secrets) });
            });
          };
          pipe(child.stdout, "out");
          pipe(child.stderr, "err");
          const done = (code, err) => {
            clearTimeout(killer);
            busy = null;
            send({ stream: "exit", code: code ?? -1, ...(err ? { error: scrub(err, secrets) } : {}) });
            res.end();
          };
          child.on("error", (e) => done(-1, e.message));
          child.on("close", (code) => done(code));
          res.on("close", () => {
            if (busy === cmd.id) child.kill("SIGTERM");
          });
        });
      });
    },
  };
}
