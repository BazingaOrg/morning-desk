import type { MarketSnapshot } from "../../shared/market-snapshot";
import { usMarketClock, usSessionKind } from "../../shared/calendar";
import type { AssetId, CollectorResult, EvidenceItem } from "../types";

const SOURCE_NAME = "NYSE/Nasdaq calendar";
const SOURCE_URL = "https://www.nyse.com/markets/hours-calendars";
const ALL_ASSETS: AssetId[] = ["SPCX", "SNDK", "NASDAQ", "GOLD"];

export function collectCalendarEvidence(
  snapshot: MarketSnapshot,
): CollectorResult {
  const items: EvidenceItem[] = [];
  const gaps: CollectorResult["gaps"] = [];
  const observedAt = snapshot.generatedAt;

  let wallYmd = snapshot.us.wallYmd;
  let wallKind = snapshot.us.wallKind;
  let lastCompleteYmd = snapshot.us.lastCompleteYmd;

  if (!wallYmd || !wallKind) {
    try {
      const clock = usMarketClock(new Date(snapshot.generatedAt));
      wallYmd = wallYmd || clock.wallYmd;
      wallKind = wallKind || clock.wallKind;
      if (!lastCompleteYmd) lastCompleteYmd = clock.lastComplete.ymd;
    } catch {
      gaps.push({
        source: SOURCE_NAME,
        affectedAssets: ALL_ASSETS,
        capability: "CALENDAR",
        blocking: true,
        message: "US market calendar unavailable",
      });
      return { items, gaps, sourcesUsed: [] };
    }
  }

  const wallKindResolved = wallKind || usSessionKind(wallYmd);
  items.push({
    id: `ev-cal-us-wall-${wallYmd}`,
    asset: "MACRO",
    kind: "session-wall",
    observedAt,
    period: wallYmd,
    sourceTier: 1,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    title: `US wall session ${wallYmd}`,
    value: wallKindResolved,
    summary: `US wall clock ${wallYmd} kind=${wallKindResolved}`,
    verified: true,
    stale: false,
    cluster: "CALENDAR",
    signal: "CONTEXT",
    relevantAssets: ALL_ASSETS,
    limitations: [],
  });

  if (lastCompleteYmd) {
    const completeKind = usSessionKind(lastCompleteYmd);
    items.push({
      id: `ev-cal-us-complete-${lastCompleteYmd}`,
      asset: "MACRO",
      kind: "last-complete-session",
      observedAt,
      period: lastCompleteYmd,
      sourceTier: 1,
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      title: `US last complete session ${lastCompleteYmd}`,
      value: completeKind,
      summary: `Last complete US session ${lastCompleteYmd} kind=${completeKind}`,
      verified: true,
      stale: false,
      cluster: "CALENDAR",
      signal: "CONTEXT",
      relevantAssets: ALL_ASSETS,
      limitations: [],
    });
  } else {
    gaps.push({
      source: SOURCE_NAME,
      affectedAssets: ALL_ASSETS,
      capability: "CALENDAR",
      blocking: true,
      message: "US lastCompleteYmd missing",
    });
  }

  return { items, gaps, sourcesUsed: [SOURCE_NAME] };
}
