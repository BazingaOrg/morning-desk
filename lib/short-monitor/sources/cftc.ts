import { spawnSync } from "node:child_process";
import { getJson } from "../../facts/http";
import { addCalendarDays, daysBetween } from "../../time";
import type { MarketSnapshot } from "../../shared/market-snapshot";
import type { CollectorResult, EvidenceItem } from "../types";

const COT_URL =
  "https://publicreporting.cftc.gov/resource/rxbv-e226.json" +
  "?$where=commodity_name='GOLD'%20AND%20contract_market_name='GOLD'%20AND%20futonly_or_combined='FutOnly'" +
  "&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=2";
const SOURCE_NAME = "CFTC COT";

type CotRow = {
  report_date_as_yyyy_mm_dd?: string;
  open_interest_all?: string;
  m_money_positions_long_all?: string;
  m_money_positions_short_all?: string;
};

async function loadGoldCotRows(): Promise<CotRow[] | null> {
  const viaFetch = await getJson<CotRow[]>(
    COT_URL,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "MorningDesk/0.1",
      },
    },
    15000,
  );
  if (viaFetch?.length) return viaFetch;

  try {
    const result = spawnSync(
      "curl",
      ["-sS", "-m", "15", "-A", "MorningDesk/0.1", COT_URL],
      { encoding: "utf8" },
    );
    if (result.status !== 0 || !result.stdout) return null;
    const parsed = JSON.parse(result.stdout) as CotRow[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function collectCftcEvidence(
  snapshot: MarketSnapshot,
): Promise<CollectorResult> {
  const unavailable = (message: string): CollectorResult => ({
    items: [],
    gaps: [{
      source: SOURCE_NAME,
      affectedAssets: ["GOLD"],
      capability: "POSITIONING",
      blocking: true,
      message,
    }],
    sourcesUsed: [],
  });
  try {
    const rows = await loadGoldCotRows();
    const row = rows?.[0];
    if (!row?.report_date_as_yyyy_mm_dd) {
      return unavailable("CFTC COT unavailable");
    }
    const asOf = row.report_date_as_yyyy_mm_dd.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return unavailable("CFTC COT unavailable");
    }
    const reportDate = addCalendarDays(asOf, 3);
    const openInterest = Number(row.open_interest_all);
    const managedMoneyLong = Number(row.m_money_positions_long_all);
    const managedMoneyShort = Number(row.m_money_positions_short_all);
    if (
      ![openInterest, managedMoneyLong, managedMoneyShort].every((n) =>
        Number.isFinite(n),
      )
    ) {
      return unavailable("CFTC COT unavailable");
    }
    const net = managedMoneyLong - managedMoneyShort;
    const previous = rows?.[1];
    const previousLong = Number(previous?.m_money_positions_long_all);
    const previousShort = Number(previous?.m_money_positions_short_all);
    const hasPrevious =
      Boolean(previous?.report_date_as_yyyy_mm_dd) &&
      Number.isFinite(previousLong) &&
      Number.isFinite(previousShort);
    const netChange = hasPrevious ? net - (previousLong - previousShort) : null;
    const age = daysBetween(asOf, snapshot.beijingDate);
    const stale = age < 0 || age > 10;
    const signal =
      netChange == null
        ? "CONTEXT"
        : netChange < 0
          ? "BEARISH"
          : netChange > 0
            ? "BULLISH"
            : "NEUTRAL";
    const item: EvidenceItem = {
      id: `ev-cftc-gold-cot-${asOf}`,
      asset: "GOLD",
      kind: "cftc-cot",
      observedAt: snapshot.generatedAt,
      period: asOf,
      publishedAt: reportDate,
      sourceTier: 1,
      sourceName: SOURCE_NAME,
      sourceUrl: "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
      title: "Gold futures disaggregated COT",
      value: net,
      unit: "contracts",
      summary: `reportDate=${reportDate} asOf=${asOf} OI=${openInterest} MM_long=${managedMoneyLong} MM_short=${managedMoneyShort} MM_net=${net} MM_net_change=${netChange ?? "N/A"}`,
      verified: !stale && hasPrevious,
      stale,
      cluster: "POSITIONING",
      signal,
      relevantAssets: ["GOLD"],
      limitations: [
        "Disaggregated futures-only weekly COT; reportDate is Friday release after Tuesday asOf",
        ...(hasPrevious ? [] : ["single period cannot establish positioning direction"]),
        ...(stale ? [`report is ${age} calendar days behind cutoff`] : []),
      ],
    };
    const gaps: CollectorResult["gaps"] = [];
    if (!hasPrevious) {
      gaps.push({
        source: SOURCE_NAME,
        affectedAssets: ["GOLD"],
        capability: "POSITIONING",
        blocking: true,
        message: "CFTC COT needs two reporting periods",
      });
    }
    if (stale) {
      gaps.push({
        source: SOURCE_NAME,
        affectedAssets: ["GOLD"],
        capability: "POSITIONING",
        blocking: true,
        message: `CFTC COT stale: asOf=${asOf}`,
      });
    }
    return { items: [item], gaps, sourcesUsed: [SOURCE_NAME] };
  } catch {
    return unavailable("CFTC COT unavailable");
  }
}
