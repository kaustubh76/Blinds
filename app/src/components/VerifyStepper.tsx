/**
 * The trust moment, shown as work: what is fetched, from where, and what is checked, with the
 * elapsed time of each stage. The copy says exactly what is and is not being trusted.
 */
import { type PrintVerdict, TICKS } from "@thewindow/solana-sdk";
import { type StageRecord, type UiStage, type VerifyResult, verified } from "../features/explorer/useVerify";
import { formatRate, formatUsdc } from "../lib/format";
import { Icon } from "./Icon";
import { Badge, ExplorerLink } from "./ui";

const ORDER: UiStage[] = ["accounts", "signatures", "transactions", "proofs", "verify", "clear"];
const TITLE: Record<UiStage, string> = {
  accounts: "Fetch the Epoch and Print accounts",
  signatures: "Find the attest transactions on the Print account",
  transactions: "Download them and extract the inline zero-ciphertext proofs",
  proofs: "Assemble the proof data",
  verify: `Verify every proof against the ${2 * TICKS} on-chain accumulators, in wasm`,
  clear: "Recompute r* and the matched volume from the proven sums",
};

function meta(s: StageRecord | undefined): string {
  if (!s) return "";
  switch (s.stage) {
    case "accounts":
      return "2 accounts";
    case "signatures":
      return s.endedAt ? "" : "…";
    case "transactions":
      return s.total !== undefined ? `${s.count ?? 0} / ${s.total}` : "";
    case "proofs":
      return s.count !== undefined ? `${s.count} × 192 B` : "";
    case "verify":
      return s.count !== undefined ? `${s.count} proof${s.count === 1 ? "" : "s"}` : "";
    default:
      return "";
  }
}

export function VerifyStepper({
  stages,
  running,
  result,
  error,
  onChain,
  cluster,
}: {
  stages: StageRecord[];
  running: boolean;
  result: VerifyResult | null;
  error: Error | null;
  onChain: { rStar: number | null; matched: bigint } | null;
  cluster: string;
}) {
  const now = performance.now();
  const started = stages.length > 0 || running;
  return (
    <div>
      <ol className="space-y-2">
        {ORDER.map((stage, i) => {
          const rec = stages.find((s) => s.stage === stage);
          const state: "todo" | "running" | "done" = !rec ? "todo" : rec.endedAt === undefined ? "running" : "done";
          const ms = rec ? Math.round((rec.endedAt ?? now) - rec.startedAt) : null;
          return (
            <li key={stage} className="flex items-start gap-3 text-sm" data-state={state}>
              <span
                className={`mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                  state === "done"
                    ? "border-status-good/50 text-status-good"
                    : state === "running"
                      ? "border-accent text-accent"
                      : "border-line text-ink-3"
                }`}
              >
                {state === "done" ? (
                  <Icon name="check" size={10} />
                ) : state === "running" ? (
                  <Icon name="refresh" size={10} className="animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <span className={`flex-1 ${state === "todo" && started ? "text-ink-3" : "text-ink-1"}`}>
                {TITLE[stage]}
              </span>
              <span className="mono w-24 shrink-0 text-right text-xs text-ink-3">{meta(rec)}</span>
              <span className="mono w-16 shrink-0 text-right text-xs text-ink-3">{ms !== null ? `${ms} ms` : ""}</span>
            </li>
          );
        })}
      </ol>
      {error && (
        <p className="mt-3 text-xs text-status-critical">
          <Icon name="alert" size={12} /> {error.message}
        </p>
      )}
      {result && <Verdict result={result} onChain={onChain} cluster={cluster} />}
    </div>
  );
}

export function Verdict({
  result,
  onChain,
  cluster,
}: {
  result: VerifyResult;
  onChain: { rStar: number | null; matched: bigint } | null;
  cluster: string;
}) {
  const v: PrintVerdict = result.verdict;
  const agree =
    onChain && result.local ? onChain.rStar === result.local.rStar && onChain.matched === result.local.matched : null;
  const ok = verified(result, onChain);
  return (
    <div
      className={`mt-4 rounded-[var(--radius-md)] border px-4 py-3 animate-stamp ${
        ok ? "border-status-good/50 bg-status-good/5" : "border-status-critical/50 bg-status-critical/5"
      }`}
      role="status"
    >
      <div className="flex items-center gap-2">
        <Icon name={ok ? "shield" : "x"} size={16} className={ok ? "text-status-good" : "text-status-critical"} />
        <span className="text-sm font-semibold text-ink-1">
          {ok ? "Re-verified in this browser" : "Verification failed"}
        </span>
        <span className="mono ml-auto text-xs text-ink-3">{Math.round(result.elapsedMs)} ms</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <Row k="ticks proven" v={`${v.proven} / ${v.nonzero}`} />
        <Row k="r* recomputed" v={v.r_star_recomputed === null ? "no trade" : formatRate(v.r_star_recomputed)} />
        <Row
          k="r* on chain"
          v={onChain?.rStar === null || onChain?.rStar === undefined ? "no trade" : formatRate(onChain.rStar)}
        />
        <Row k="matched" v={result.local ? formatUsdc(result.local.matched) : "—"} />
      </dl>
      {v.proofTransactions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span>
            {v.proofTransactions.length} attest transaction{v.proofTransactions.length === 1 ? "" : "s"}
          </span>
          {v.proofTransactions.slice(0, 6).map((sig) => (
            <ExplorerLink key={sig} address={sig} cluster={cluster} kind="tx" />
          ))}
        </div>
      )}
      {v.failures.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-status-critical">
          {v.failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {agree === false && (
        <p className="mt-2 text-xs text-status-critical">The printed rate does not match what the proven sums imply.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="mute" icon="shield">
          same verifier the chain ran, compiled to wasm
        </Badge>
        <Badge tone="mute">accounts + transactions from the RPC you configured</Badge>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line py-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className="num font-medium text-ink-1">{v}</dd>
    </div>
  );
}
