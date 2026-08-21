import { readFileSync } from "node:fs";
import path from "node:path";
import { daysBetween, inNextDays } from "../../time";
import type { MarketSnapshot } from "../../shared/market-snapshot";
import type { AssetId, CollectorResult, EvidenceItem } from "../types";

const SOURCE_NAME = "static official calendar";
const ALL_ASSETS: AssetId[] = ["SPCX", "SNDK", "NASDAQ", "GOLD"];
const FILE = path.join(
  process.cwd(),
  "data",
  "short-monitor",
  "catalyst-calendar.json",
);

type CatalystEvent = {
  date: string;
  title: string;
  kind: string;
  sourceUrl: string;
};

type CatalystPayload = {
  version: number;
  updatedAt: string;
  events: CatalystEvent[];
};

export function loadCatalystCalendar(): CatalystPayload {
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as CatalystPayload;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.updatedAt) || !Array.isArray(raw.events)) {
    throw new Error("invalid catalyst calendar");
  }
  return raw;
}

export function collectCatalystEvidence(
  snapshot: MarketSnapshot,
): CollectorResult {
  const items: EvidenceItem[] = [];
  const gaps: CollectorResult["gaps"] = [];
  let calendar: CatalystPayload;
  try {
    calendar = loadCatalystCalendar();
  } catch {
    return {
      items: [],
      gaps: [{
        source: SOURCE_NAME,
        affectedAssets: ALL_ASSETS,
        capability: "CATALYST",
        blocking: true,
        message: "catalyst calendar unavailable",
      }],
      sourcesUsed: [],
    };
  }

  const from = snapshot.beijingDate;
  const age = daysBetween(calendar.updatedAt, from);
  const stale = age < 0 || age > 45;
  if (stale) {
    gaps.push({
      source: SOURCE_NAME,
      affectedAssets: ALL_ASSETS,
      capability: "CATALYST",
      blocking: true,
      message: `catalyst calendar stale: updatedAt=${calendar.updatedAt}`,
    });
  }
  for (const event of calendar.events) {
    if (!inNextDays(event.date, from, 30)) continue;
    items.push({
      id: `ev-cat-${event.kind}-${event.date}`,
      asset: "MACRO",
      kind: event.kind,
      observedAt: snapshot.generatedAt,
      period: event.date,
      sourceTier: 1,
      sourceName: SOURCE_NAME,
      sourceUrl: event.sourceUrl,
      title: event.title,
      summary: `${event.title} on ${event.date}`,
      verified: !stale,
      stale,
      cluster: "CATALYST",
      signal: "CONTEXT",
      relevantAssets: ALL_ASSETS,
      limitations: [`V1 static; updatedAt=${calendar.updatedAt}; not live scrape`],
    });
  }

  return {
    items,
    gaps,
    sourcesUsed: items.length ? [SOURCE_NAME] : [],
  };
}
