import type {
  AssetModelView,
  DeepSeekAssetMap,
  DeepSeekOutput,
  TierLevel,
} from "./types";

export type { DeepSeekOutput };

const TIER_LEVELS: ReadonlySet<string> = new Set([
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "VERY_HIGH",
]);

const ASSET_IDS = ["SPCX", "SNDK", "NASDAQ", "GOLD"] as const;

const FORBIDDEN_KEYS = [
  "score",
  "subscore",
  "priceConfirmation",
  "action",
  "state",
  "positionSize",
] as const;

const ROOT_KEYS = ["schemaVersion", "assets", "notes"] as const;
const ASSET_VIEW_KEYS = [
  "consensus",
  "variant",
  "falsification",
  "inflection",
  "fundamentalShift",
  "expectationGap",
  "catalystStrength",
  "evidenceConfidence",
  "priceReactionFunction",
  "evidenceIds",
  "bullCase",
  "bearCase",
  "missingData",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTierLevel(value: unknown): value is TierLevel {
  return typeof value === "string" && TIER_LEVELS.has(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isAssetModelView(value: unknown): value is AssetModelView {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ASSET_VIEW_KEYS)) return false;
  return (
    typeof value.consensus === "string" &&
    typeof value.variant === "string" &&
    typeof value.falsification === "string" &&
    typeof value.inflection === "string" &&
    isTierLevel(value.fundamentalShift) &&
    isTierLevel(value.expectationGap) &&
    isTierLevel(value.catalystStrength) &&
    isTierLevel(value.evidenceConfidence) &&
    isTierLevel(value.priceReactionFunction) &&
    isStringArray(value.evidenceIds) &&
    typeof value.bullCase === "string" &&
    typeof value.bearCase === "string" &&
    isStringArray(value.missingData)
  );
}

function hasForbiddenKeysDeep(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKeysDeep(item));
  }
  if (!isRecord(value)) return false;
  for (const key of FORBIDDEN_KEYS) {
    if (key in value) return true;
  }
  return Object.values(value).some((nested) => hasForbiddenKeysDeep(nested));
}

export function isDeepSeekOutput(value: unknown): value is DeepSeekOutput {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ROOT_KEYS)) return false;
  if (value.schemaVersion !== 1) return false;
  if (value.notes !== undefined && typeof value.notes !== "string") return false;
  if (!isRecord(value.assets)) return false;
  if (!hasOnlyKeys(value.assets, ASSET_IDS)) return false;
  if (hasForbiddenKeysDeep(value)) return false;

  const assets = value.assets;
  for (const id of ASSET_IDS) {
    if (!isAssetModelView(assets[id])) return false;
  }

  return true;
}

export function parseDeepSeekOutput(value: unknown): DeepSeekOutput | null {
  if (!isDeepSeekOutput(value)) return null;
  const assets = {} as DeepSeekAssetMap;
  for (const id of ASSET_IDS) {
    assets[id] = value.assets[id];
  }
  return {
    schemaVersion: value.schemaVersion,
    assets,
    ...(value.notes !== undefined ? { notes: value.notes } : {}),
  };
}
