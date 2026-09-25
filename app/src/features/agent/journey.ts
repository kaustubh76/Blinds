/**
 * The lender agent's journey, computed from the launch records and the pool — never from a claim.
 * Every step that is not done says what it waits on.
 */
import { type LaunchRecord, MAINNET_PLAN } from "../../lib/launch";

export type StepState = "done" | "pending" | "blocked";

export interface JourneyStep {
  id: "identity" | "rehearsal" | "mainnet" | "coin" | "graduation";
  title: string;
  state: StepState;
  /** What happened, or what it waits on. */
  detail: string;
  /** A link into the product or an explorer, when there is one. */
  href?: string | undefined;
  /**
   * Ids of the `services/launch` commands that move this step along, in the order you would run them
   * (`app/vite/devBridge.mjs`). With the repo checked out they are buttons; on the hosted site they
   * are lines to copy. A step with none is one nothing can be done about from here.
   */
  commands?: readonly string[];
}

/**
 * The key that pays for the mainnet pool. It comes from the mainnet plan record (`payer`, written by
 * `services/launch plan`); the literal is only the fallback for a checkout without that record.
 */
export const LAUNCH_KEY_FALLBACK = "3bku8abYECxZxfoXDsTjcCCBv7JMF6BKTREeJLeVDnJX";

export function journey(
  devnet: LaunchRecord | null,
  mainnet: LaunchRecord | null,
  live: { isMigrated: boolean; progress: number } | null,
): JourneyStep[] {
  const agent = mainnet?.agent ?? devnet?.agent ?? null;
  const past = mainnet?.previousGraduation ?? devnet?.previousGraduation ?? null;
  const coin = mainnet?.clawpump ?? devnet?.clawpump ?? null;
  const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
  const launchKey = mainnet?.payer ?? MAINNET_PLAN?.payer ?? LAUNCH_KEY_FALLBACK;
  const steps: JourneyStep[] = [
    agent
      ? {
          id: "identity",
          title: "A Clawpump identity",
          state: "done",
          detail: `${agent.name} · ${agent.status === "running" ? "running on Clawpump" : `status ${agent.status ?? "unknown"}`} · wallet ${short(agent.walletAddress)} — the pool's creator and fee wallet`,
          href: `https://explorer.solana.com/address/${agent.walletAddress}`,
          commands: ["agent-status", "agent-upsert"],
        }
      : {
          id: "identity",
          title: "A Clawpump identity",
          state: "pending",
          detail: "waits on services/launch agent (needs CLAWPUMP_API_KEY)",
          commands: ["agent-upsert", "agent-status"],
        },
    devnet?.pool
      ? {
          id: "rehearsal",
          title: "Devnet rehearsal on Meteora DBC",
          state: "done",
          detail: `pool ${short(devnet.pool)} on a twin quote mint — same program, same configuration`,
          href: `https://explorer.solana.com/address/${devnet.pool}?cluster=devnet`,
          commands: ["launch-status", "launch-buy"],
        }
      : {
          id: "rehearsal",
          title: "Devnet rehearsal on Meteora DBC",
          state: "pending",
          detail: "not run yet",
          commands: ["launch-plan", "launch-preflight", "launch-create"],
        },
    mainnet?.pool
      ? {
          id: "mainnet",
          title: "The mainnet pool, quoted in TSLAx",
          state: "done",
          detail: `pool ${short(mainnet.pool)} · WLEND ${short(mainnet.baseMint)}`,
          href: `https://explorer.solana.com/address/${mainnet.pool}`,
          commands: ["launch-status"],
        }
      : {
          id: "mainnet",
          title: "The mainnet pool, quoted in TSLAx",
          state: "blocked",
          detail: `waits on ~0.05 SOL at the launch key ${short(launchKey)} — the pool cost 0.027 on devnet; nothing is sent below 0.04`,
          href: `https://explorer.solana.com/address/${launchKey}`,
          commands: ["launch-plan", "launch-preflight", "launch-create"],
        },
    coin
      ? {
          id: "coin",
          title: "The identity coin, launched by Clawpump",
          state: "done",
          detail: `${coin.symbol} on pump.fun, paired with TSLAx · mint ${short(coin.mint)}`,
          href: coin.pumpUrl,
          commands: ["agent-status"],
        }
      : {
          id: "coin",
          title: "The identity coin, launched by Clawpump",
          state: agent ? "blocked" : "pending",
          detail: agent
            ? `waits on ~0.02 SOL at the agent's wallet ${short(agent.walletAddress)} — the agent pays its own launch (0.0092 SOL for a TSLAx pair)`
            : "needs the identity first",
          href: agent ? `https://explorer.solana.com/address/${agent.walletAddress}` : undefined,
          commands: agent ? ["clawpump-preflight", "clawpump-launch"] : ["agent-upsert"],
        },
    live?.isMigrated
      ? {
          id: "graduation",
          title: "Graduation to DAMM v2",
          state: "done",
          detail: "this pool reached its threshold; its liquidity is locked on DAMM v2",
        }
      : past
        ? {
            id: "graduation",
            title: "Graduation to DAMM v2",
            state: "done",
            detail: `rehearsed end to end: pool ${short(past.pool)} filled its curve and migrated${past.dammPool ? ` into DAMM v2 pool ${short(past.dammPool)}` : ""} — the pool above is the live one${live ? `, ${(live.progress * 100).toFixed(1)} % of the way` : ""}`,
            href: past.dammPool
              ? `https://explorer.solana.com/address/${past.dammPool}?cluster=devnet`
              : `https://explorer.solana.com/tx/${past.tx}?cluster=devnet`,
            commands: ["launch-buy", "launch-graduate"],
          }
        : {
            id: "graduation",
            title: "Graduation to DAMM v2",
            state: "pending",
            detail: live
              ? `${(live.progress * 100).toFixed(1)} % of the raise so far — buyers move the curve, nothing else does`
              : "once the pool reads, its progress shows here",
            commands: ["launch-buy", "launch-graduate"],
          },
  ];
  return steps;
}
