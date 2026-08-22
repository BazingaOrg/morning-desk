import { getJson, getText } from "../../facts/http";
import { addCalendarDays, daysBetween } from "../../time";
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

type ObsRow = { date: string; value: number };

function gapFor(meta: (typeof SERIES)[number], message: string): EvidenceGap {
  return {
    source: "FRED",
    affectedAssets: [...meta.relevantAssets],
    capability: meta.cluster === "LIQUIDITY" ? "LIQUIDITY" : "RATES",
    blocking: true,
    message,
  };
}

function buildSeriesEvidence(
  meta: (typeof SERIES)[number],
  observations: ObsRow[],
  snapshot: MarketSnapshot,
  extraLimitations: string[],
): { item?: EvidenceItem; gap?: EvidenceGap } {
  if (observations.length < 2) {
    return { gap: gapFor(meta, `FRED ${meta.id} needs two numeric observations`) };
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
  return {
    item: {
      id: `ev-fred-${meta.id}-${latest.date}`,
      asset: "MACRO",
      kind: "fred-observation",
      observedAt: snapshot.generatedAt,
      period: latest.date,
      publishedAt: latest.date,
      sourceTier: 1,
      sourceName: "FRED",
      sourceUrl: `https://fred.stlouisfed.org/series/${meta.id}`,
      title: meta.title,
      value: latest.value,
      unit: meta.cluster === "LIQUIDITY" ? "millions USD" : "percent",
      summary: `${meta.id}=${latest.value} on ${latest.date}; previous=${previous.value} on ${previous.date}; delta=${delta.toFixed(3)}`,
      verified: !stale,
      stale,
      cluster: meta.cluster,
      signal,
      relevantAssets: [...meta.relevantAssets],
      limitations: [
        ...(stale ? [`latest observation is ${age} calendar days behind cutoff`] : []),
        ...extraLimitations,
      ],
    },
    ...(stale ? { gap: gapFor(meta, `FRED ${meta.id} stale: latest=${latest.date}`) } : {}),
  };
}

type FredObs = {
  observations?: Array<{ date: string; value: string }>;
};

async function fetchSeriesJson(
  seriesId: string,
  apiKey: string,
): Promise<ObsRow[] | null> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${encodeURIComponent(apiKey)}` +
    `&file_type=json&sort_order=desc&limit=5`;
  const payload = await getJson<FredObs>(url, {}, 12000);
  if (!payload?.observations?.length) return null;
  const rows = payload.observations
    .map((observation) => ({
      date: observation.date,
      value: Number(observation.value),
    }))
    .filter((observation) => Number.isFinite(observation.value));
  return rows.length ? rows : null;
}

export function csvObservations(text: string): ObsRow[] {
  const rows: ObsRow[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const comma = line.lastIndexOf(",");
    if (comma <= 0) continue;
    const date = line.slice(0, comma).trim();
    const raw = line.slice(comma + 1).trim();
    const value = Number(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) continue;
    rows.push({ date, value });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function fetchSeriesCsv(
  seriesId: string,
  snapshot: MarketSnapshot,
): Promise<ObsRow[] | null> {
  const cutoff = snapshot.us.lastCompleteYmd
    ? addCalendarDays(snapshot.us.lastCompleteYmd, -45)
    : undefined;
  const url =
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}` +
    (cutoff ? `&cosd=${cutoff}` : "");
  const { ok, text } = await getText(url, {}, 12000);
  if (!ok || !text) return null;
  const rows = csvObservations(text);
  return rows.length >= 2 ? rows.slice(-2).reverse() : (rows.length ? rows : null);
}

export async function collectFredEvidence(
  snapshot: MarketSnapshot,
): Promise<CollectorResult> {
  const apiKey = process.env.FRED_API_KEY;
  const keyless = !apiKey;
  const items: EvidenceItem[] = [];
  const gaps: EvidenceGap[] = [];

  for (const series of SERIES) {
    try {
      const observations = apiKey
        ? await fetchSeriesJson(series.id, apiKey)
        : await fetchSeriesCsv(series.id, snapshot);
      if (observations == null) {
        gaps.push(gapFor(
          series,
          `FRED ${series.id} unavailable${keyless ? " (keyless feed)" : ""}`,
        ));
        continue;
      }
      const result = buildSeriesEvidence(
        series,
        observations,
        snapshot,
        keyless ? ["keyless fredgraph.csv fallback"] : [],
      );
      if (result.item) items.push(result.item);
      if (result.gap) gaps.push(result.gap);
    } catch {
      gaps.push(gapFor(
        series,
        `FRED ${series.id} unavailable${keyless ? " (keyless feed)" : ""}`,
      ));
    }
  }

  return {
    items,
    gaps,
    sourcesUsed: items.length ? ["FRED"] : [],
  };
}
