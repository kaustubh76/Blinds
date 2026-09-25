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
  /** The identity coin as mainnet holds it: `null` until the mint answers, so a step can wait for it. */
  coinOnChain?: { supply: number } | null,
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
          detail: `${agent.name} · ${agent.status === "running" ? `running on Clawpump${agent.checkedAt ? ` (checked ${new Date(agent.checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})` : ""}` : `status ${agent.status ?? "unknown"}`} · ${short(agent.walletAddress)}, the fee wallet`,
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
          detail: `pool ${short(devnet.pool)} · a twin quote mint, same program`,
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
          // `live` is the pool decoded from the chain. Without it this step used to go green on the
          // presence of a JSON key, so a record ahead of the chain showed "done" over a card saying
          // the pool was not there.
          title: "The mainnet pool, quoted in TSLAx",
          state: live ? "done" : "pending",
          detail: live
            ? `pool ${short(mainnet.pool)} · WLEND ${short(mainnet.baseMint)}`
            : `pool ${short(mainnet.pool)} recorded · reading it from mainnet`,
          href: `https://explorer.solana.com/address/${mainnet.pool}`,
          commands: ["launch-status"],
        }
      : {
          id: "mainnet",
          title: "The mainnet pool, quoted in TSLAx",
          state: "blocked",
          detail: `waits on ~0.05 SOL at ${short(launchKey)} · nothing is sent below 0.04`,
          href: `https://explorer.solana.com/address/${launchKey}`,
          commands: ["launch-plan", "launch-preflight", "launch-create"],
        },
    coin
      ? {
          id: "coin",
          title: "The identity coin, launched by Clawpump",
          // The mint, not the record: a record ahead of the chain used to show this green over a badge
          // saying mainnet had not answered — the same contradiction the pool step was fixed for.
          state: coinOnChain ? "done" : "pending",
          detail: coinOnChain
            ? `${coin.symbol} on pump.fun · ${coinOnChain.supply.toLocaleString("en-US")} minted · mint ${short(coin.mint)}`
            : `${coin.symbol} recorded at ${short(coin.mint)} · reading mainnet`,
          href: coin.pumpUrl,
          commands: ["agent-status"],
        }
      : {
          id: "coin",
          title: "The identity coin, launched by Clawpump",
          state: agent ? "blocked" : "pending",
          detail: agent
            ? `waits on ~0.02 SOL at ${short(agent.walletAddress)} · the agent pays its own launch`
            : "needs the identity first",
          href: agent ? `https://explorer.solana.com/address/${agent.walletAddress}` : undefined,
          commands: agent ? ["clawpump-preflight", "clawpump-launch"] : ["agent-upsert"],
        },
    live?.isMigrated
      ? {
          id: "graduation",
          title: "Graduation to DAMM v2",
          state: "done",
          detail: "threshold reached · liquidity locked on DAMM v2",
        }
      : past
        ? {
            id: "graduation",
            title: "Graduation to DAMM v2",
            state: "done",
            detail: `rehearsed end to end${past.dammPool ? ` into DAMM v2 ${short(past.dammPool)}` : ""} · the pool above is the live one${live ? `, ${(live.progress * 100).toFixed(1)} % of the way` : ""}`,
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
