import { getJson } from "../../facts/http";
import { daysBetween } from "../../time";
import type { MarketSnapshot } from "../../shared/market-snapshot";
import type { AssetId, CollectorResult, EvidenceGap, EvidenceItem } from "../types";

const SERIES = [
  {
    id: "DGS10",
    title: "Nominal 10Y Treasury yield",
    relevantAssets: ["SPCX", "SNDK", "NASDAQ"] as AssetId[],
    cluster: "RATES" as const,
    bearishDirection: "UP" as const,
    threshold: 0.05,
    maxAgeDays: 5,
  },
  {
    id: "DFII10",
    title: "10Y TIPS real yield",
    relevantAssets: ["SPCX", "SNDK", "NASDAQ", "GOLD"] as AssetId[],
    cluster: "RATES" as const,
    bearishDirection: "UP" as const,
    threshold: 0.05,
    maxAgeDays: 5,
  },
  {
    id: "WALCL",
    title: "Federal Reserve total assets",
    relevantAssets: ["NASDAQ", "GOLD"] as AssetId[],
    cluster: "LIQUIDITY" as const,
    bearishDirection: "DOWN" as const,
    threshold: 0.002,
    maxAgeDays: 8,
  },
] as const;

export const FRED_AFFECTED_ASSETS: AssetId[] = [
  ...new Set(SERIES.flatMap((series) => [...series.relevantAssets])),
];

type FredObs = {
  observations?: Array<{ date: string; value: string }>;
};

async function fetchSeries(
  seriesId: string,
  apiKey: string,
  snapshot: MarketSnapshot,
): Promise<{ item?: EvidenceItem; gap?: EvidenceGap }> {
  const meta = SERIES.find((s) => s.id === seriesId)!;
  const gap = (message: string): EvidenceGap => ({
    source: "FRED",
    affectedAssets: [...meta.relevantAssets],
    capability: meta.cluster === "LIQUIDITY" ? "LIQUIDITY" : "RATES",
    blocking: true,
    message,
  });
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${encodeURIComponent(apiKey)}` +
    `&file_type=json&sort_order=desc&limit=5`;
  const payload = await getJson<FredObs>(url, {}, 12000);
  if (!payload?.observations?.length) {
    return { gap: gap(`FRED ${seriesId} unavailable`) };
  }
  const observations = payload.observations
    .map((observation) => ({
      date: observation.date,
      value: Number(observation.value),
    }))
    .filter((observation) => Number.isFinite(observation.value));
  if (observations.length < 2) {
    return { gap: gap(`FRED ${seriesId} needs two numeric observations`) };
  }
  const [latest, previous] = observations;
  const age = snapshot.us.lastCompleteYmd
    ? daysBetween(latest.date, snapshot.us.lastCompleteYmd)
    : Number.POSITIVE_INFINITY;
  const stale = age < 0 || age > meta.maxAgeDays;
  const delta = latest.value - previous.value;
  const comparableDelta = meta.cluster === "LIQUIDITY"
    ? delta / Math.abs(previous.value || 1)
    : delta;
  const directionalDelta = meta.bearishDirection === "UP"
    ? comparableDelta
    : -comparableDelta;
  const signal = directionalDelta > meta.threshold
    ? "BEARISH"
    : directionalDelta < -meta.threshold
      ? "BULLISH"
      : "NEUTRAL";
  const staleGap = stale ? gap(`FRED ${seriesId} stale: latest=${latest.date}`) : undefined;
  return {
    item: {
      id: `ev-fred-${seriesId}-${latest.date}`,
      asset: "MACRO",
      kind: "fred-observation",
      observedAt: snapshot.generatedAt,
      period: latest.date,
      publishedAt: latest.date,
      sourceTier: 1,
      sourceName: "FRED",
      sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
      title: meta.title,
      value: latest.value,
      unit: meta.cluster === "LIQUIDITY" ? "millions USD" : "percent",
      summary: `${seriesId}=${latest.value} on ${latest.date}; previous=${previous.value} on ${previous.date}; delta=${delta.toFixed(3)}`,
      verified: !stale,
      stale,
      cluster: meta.cluster,
      signal,
      relevantAssets: [...meta.relevantAssets],
      limitations: stale ? [`latest observation is ${age} calendar days behind cutoff`] : [],
    },
    ...(staleGap ? { gap: staleGap } : {}),
  };
}

export async function collectFredEvidence(
  snapshot: MarketSnapshot,
): Promise<CollectorResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return {
      items: [],
      gaps: [{
        source: "FRED",
        affectedAssets: [...FRED_AFFECTED_ASSETS],
        capability: "RATES",
        blocking: true,
        message: "FRED_API_KEY unset",
      }],
      sourcesUsed: [],
    };
  }

  const items: EvidenceItem[] = [];
  const gaps: EvidenceGap[] = [];

  for (const series of SERIES) {
    try {
      const result = await fetchSeries(series.id, apiKey, snapshot);
      if (result.item) items.push(result.item);
      if (result.gap) gaps.push(result.gap);
    } catch {
      gaps.push({
        source: "FRED",
        affectedAssets: [...series.relevantAssets],
        capability: "RATES",
        blocking: true,
        message: `FRED ${series.id} unavailable`,
      });
    }
  }

  return {
    items,
    gaps,
    sourcesUsed: items.length ? ["FRED"] : [],
  };
}
