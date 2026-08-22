import type { AssetId, MonitorState, TierLevel } from "./types";

export const SCORE_VERSION = 2;

export const SCORE_WEIGHTS = {
  fundamentalShift: 30,
  expectationGap: 15,
  industryMacro: 20,
  marketConfirmation: 25,
  catalyst: 10,
} as const;

export const MARKET_CONFIRMATION_PRICE_PART = 20;
export const MARKET_CONFIRMATION_LIQUIDITY_PART = 5;
export const EARLY_CLOSE_LIQUIDITY_FACTOR = 0.5;

export const TIER_FRACTION: Record<TierLevel, number> = {
  NONE: 0,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  VERY_HIGH: 1.0,
};

export type ScoreInput = {
  asset: AssetId;
  fundamentalShift: TierLevel;
  expectationGap: TierLevel;
  catalystStrength: TierLevel;
  priceConfirmation: boolean;
  independentDrivers: number;
  volumeRatio?: number | null;
  sessionKind?: "regular" | "early-close";
};

export function marketConfirmationPoints(input: Pick<ScoreInput, "priceConfirmation" | "volumeRatio" | "sessionKind">): number {
  if (!input.priceConfirmation) return 0;
  let liquidity =
    input.volumeRatio != null && input.volumeRatio >= 1
      ? MARKET_CONFIRMATION_LIQUIDITY_PART
      : 0;
  if (input.sessionKind === "early-close") {
    liquidity *= EARLY_CLOSE_LIQUIDITY_FACTOR;
  }
  return MARKET_CONFIRMATION_PRICE_PART + liquidity;
}

function clampDrivers(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(3, Math.floor(n));
}

export function tierPoints(weight: number, tier: TierLevel): number {
  return weight * TIER_FRACTION[tier];
}

export function computeRawScore(input: ScoreInput): number {
  const drivers = clampDrivers(input.independentDrivers);
  const macroFraction = drivers / 3;
  return (
    tierPoints(SCORE_WEIGHTS.fundamentalShift, input.fundamentalShift) +
    tierPoints(SCORE_WEIGHTS.expectationGap, input.expectationGap) +
    SCORE_WEIGHTS.industryMacro * macroFraction +
    marketConfirmationPoints(input) +
    tierPoints(SCORE_WEIGHTS.catalyst, input.catalystStrength)
  );
}

export function applyScoreCaps(raw: number, input: ScoreInput): number {
  let score = raw;
  const gapHigh =
    input.expectationGap === "HIGH" || input.expectationGap === "VERY_HIGH";
  const fundWeak =
    input.fundamentalShift === "NONE" || input.fundamentalShift === "LOW";
  if (gapHigh && fundWeak && !input.priceConfirmation) {
    score = Math.min(score, 40);
  }

  const drivers = clampDrivers(input.independentDrivers);
  if (input.asset === "NASDAQ") {
    if (drivers < 2 || !input.priceConfirmation) {
      score = Math.min(score, 49);
    }
  }
  if (input.asset === "GOLD") {
    if (drivers < 3) {
      score = Math.min(score, 69);
    }
  }
  return score;
}

export function computeScore(input: ScoreInput): number {
  return Math.round(applyScoreCaps(computeRawScore(input), input));
}

export function stateFromScore(score: number): MonitorState {
  if (score >= 80) return "TRIGGERED";
  if (score >= 70) return "CONFIRMING";
  if (score >= 50) return "ARMED";
  return "WATCH";
}

export function isMediumOrAbove(tier: TierLevel): boolean {
  return (
    tier === "MEDIUM" || tier === "HIGH" || tier === "VERY_HIGH"
  );
}
