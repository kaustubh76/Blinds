/**
 * The lender agent's launch, as numbers: a Meteora DBC config quoted in a tokenized stock, derived
 * from the desk's own quantities rather than a meme template.
 *
 *   • the raise (`migrationMarketCap`, and with it `migration_quote_threshold`) is the agent's target
 *     lending capital in USD, converted into the quote stock through the same Pyth read the desk marks
 *     collateral with — a stock-quoted pool priced in dollars;
 *   • the trading fee starts wide and decays over one overnight window (the desk's tenor), then rests;
 *   • every graduated LP position is locked forever (no one, us included, can pull the pool), and the
 *     creator fee stream is the agent's wallet — the "revenue" a Clawpump agent lives on;
 *   • a slice of the raise (the migration fee) is paid to the agent at graduation: its lending capital.
 *
 * Pure: no RPC, no signing — unit-tested with fixture quotes.
 */
import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithMarketCap,
  CollectFeeMode,
  type ConfigParameters,
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DammV2DynamicFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

export interface DeskNumbers {
  /** USD per quote token, from Pyth (`Crypto.TSLAX/USD` on mainnet). */
  quoteUsd: number;
  /** Decimals of the quote mint (TSLAx: 8). */
  quoteDecimals: 6 | 7 | 8 | 9;
  /** Fully-diluted value the token starts trading at, in USD. */
  initialUsd: number;
  /** Fully-diluted value at graduation, in USD — the raise scales with it. */
  migrationUsd: number;
  /** The desk's tenor in seconds; the fee decays over one of them. */
  tenorSecs: number;
  /** Trading fee at open and at rest, in bp. */
  openFeeBps: number;
  restFeeBps: number;
  /** Share of the raise paid out at graduation, in percent (0–99). It goes to the fee claimer. */
  raiseToAgentPct: number;
  /**
   * Share of the trading fee kept by the pool's *creator*, in percent.
   *
   * Zero, deliberately. Meteora makes the creator a signer, and the agent's wallet is Clawpump's —
   * so the creator can only ever be the key that signs the launch, never the agent. The fee claimer
   * is a plain config field and *is* the agent, so putting the creator's share at zero is what makes
   * "everything the agent earns goes to one address" true rather than nearly true.
   */
  creatorFeePct: number;
  /** Base token supply (whole tokens). */
  supply: number;
}

export const DEFAULTS: Omit<DeskNumbers, "quoteUsd" | "quoteDecimals"> = {
  initialUsd: 25_000,
  migrationUsd: 250_000,
  tenorSecs: 4 * 3600,
  openFeeBps: 300,
  restFeeBps: 30,
  raiseToAgentPct: 10,
  creatorFeePct: 0,
  supply: 1_000_000_000,
};

export interface LaunchPlan {
  config: ConfigParameters;
  /** What the numbers mean, for the descriptor and the docs. */
  summary: {
    quoteUsd: number;
    initialMarketCapQuote: number;
    migrationMarketCapQuote: number;
    /** What the curve raises (in quote units) before it graduates — the program's `migration_quote_threshold`. */
    migrationQuoteThreshold: number;
    initialUsd: number;
    migrationUsd: number;
    feeBps: { open: number; rest: number; periods: number; durationSecs: number };
    raiseToAgentPct: number;
    creatorFeePct: number;
    supply: number;
  };
}

export function buildPlan(n: DeskNumbers): LaunchPlan {
  if (!(n.quoteUsd > 0)) throw new Error("the quote's USD price must be positive");
  if (n.migrationUsd <= n.initialUsd) throw new Error("migrationUsd must exceed initialUsd");
  const initialMarketCap = n.initialUsd / n.quoteUsd;
  const migrationMarketCap = n.migrationUsd / n.quoteUsd;
  const periods = 48; // five-minute steps across the tenor
  const config = buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: n.quoteDecimals as TokenDecimal,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: n.supply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
        feeSchedulerParam: {
          startingFeeBps: n.openFeeBps,
          endingFeeBps: n.restFeeBps,
          numberOfPeriod: periods,
          totalDuration: n.tenorSecs,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: n.creatorFeePct,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: true,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      // The whole migration fee follows the trading fee to the claimer, for the same reason.
      migrationFee: { feePercentage: n.raiseToAgentPct, creatorFeePercentage: n.creatorFeePct },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Enabled,
        poolFeeBps: n.restFeeBps,
      },
    },
    liquidityDistribution: {
      // Every graduated LP position is locked for good: the pool outlives us.
      partnerPermanentLockedLiquidityPercentage: 50,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap,
    migrationMarketCap,
  });
  return {
    config,
    summary: {
      quoteUsd: n.quoteUsd,
      initialMarketCapQuote: initialMarketCap,
      migrationMarketCapQuote: migrationMarketCap,
      migrationQuoteThreshold: Number(config.migrationQuoteThreshold.toString()) / 10 ** n.quoteDecimals,
      initialUsd: n.initialUsd,
      migrationUsd: n.migrationUsd,
      feeBps: { open: n.openFeeBps, rest: n.restFeeBps, periods, durationSecs: n.tenorSecs },
      raiseToAgentPct: n.raiseToAgentPct,
      creatorFeePct: n.creatorFeePct,
      supply: n.supply,
    },
  };
}

/**
 * The DAMM v2 config a migration must name: Meteora keeps one per `MigrationFeeOption`, and the pool's
 * own config says which. Getting this wrong (a hard-coded FixedBps25 against a Customizable pool) is a
 * migration that cannot pass the program's checks.
 */
export function dammConfigFor(migrationFeeOption: number, override?: string): string {
  if (override) return override;
  const addr = DAMM_V2_MIGRATION_FEE_ADDRESS[migrationFeeOption];
  if (!addr) throw new Error(`no DAMM v2 config for migration fee option ${migrationFeeOption}`);
  return addr.toString();
}
