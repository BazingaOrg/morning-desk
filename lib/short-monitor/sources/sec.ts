import { previousUsSession } from "../../shared/calendar";
import type { MarketSnapshot } from "../../shared/market-snapshot";
import { fetchSecRecent, loadTickerCikMap } from "../../facts/sec";
import { getJson, SEC_UA } from "../../facts/http";
import type { UniverseItem } from "../../types";
import { loadSecurityMaster } from "../master";
import type { AssetId, CollectorResult, EvidenceItem } from "../types";

const TARGETS: AssetId[] = ["SPCX", "SNDK"];
const SOURCE_NAME = "SEC EDGAR";

type CompanyFactUnit = {
  start?: string;
  end?: string;
  filed?: string;
  form?: string;
  fy?: number;
  fp?: string;
  val?: number;
  accn?: string;
};

type CompanyFactsPayload = {
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, CompanyFactUnit[]> }>;
  };
};

const REVENUE_FACTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
] as const;

function comparableFacts(rows: CompanyFactUnit[], cutoff: string): [CompanyFactUnit, CompanyFactUnit] | null {
  const eligible = rows
    .filter((row) =>
      (row.form === "10-Q" || row.form === "10-K") &&
      typeof row.filed === "string" && row.filed <= cutoff &&
      typeof row.end === "string" && typeof row.val === "number" && Number.isFinite(row.val) &&
      typeof row.fy === "number" && typeof row.fp === "string",
    )
    .sort((left, right) =>
      (right.filed ?? "").localeCompare(left.filed ?? "") ||
      (right.end ?? "").localeCompare(left.end ?? ""),
    );
  const latest = eligible[0];
  if (!latest) return null;
  const previous = eligible.find((row) =>
    row.fy === (latest.fy ?? 0) - 1 && row.fp === latest.fp,
  );
  return previous ? [latest, previous] : null;
}

export function companyFactEvidence(input: {
  payload: CompanyFactsPayload;
  asset: AssetId;
  cik: string;
  observedAt: string;
  cutoff: string;
}): EvidenceItem[] {
  const gaap = input.payload.facts?.["us-gaap"];
  if (!gaap) return [];
  for (const factName of REVENUE_FACTS) {
    const units = gaap[factName]?.units;
    const rows = units?.USD;
    if (!rows) continue;
    const pair = comparableFacts(rows, input.cutoff);
    if (!pair) continue;
    const [latest, previous] = pair;
    const base = previous.val as number;
    if (base === 0) continue;
    const change = (latest.val as number) / Math.abs(base) - Math.sign(base);
    const signal = change <= -0.1 ? "BEARISH" : change >= 0.1 ? "BULLISH" : "NEUTRAL";
    return [{
      id: `ev-sec-companyfacts-${input.asset}-${factName}-${latest.end}`,
      asset: input.asset,
      kind: "companyfacts-revenue-yoy",
      observedAt: input.observedAt,
      publishedAt: latest.filed,
      period: latest.end,
      sourceTier: 1,
      sourceName: SOURCE_NAME,
      sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${input.cik}.json`,
      title: `${input.asset} reported revenue comparison`,
      value: change,
      unit: "ratio",
      summary: `${factName} latest=${latest.val} previous=${previous.val} yoy=${change.toFixed(4)}`,
      verified: true,
      stale: false,
      cluster: "COMPANY",
      signal,
      relevantAssets: [input.asset],
      limitations: ["SEC XBRL fact comparison; fiscal period labels must match and direction is deterministic"],
    }];
  }
  return [];
}

function toUniverseItem(id: string, yahoo: string, name: string, identity: string[]): UniverseItem {
  return {
    id,
    display: id,
    name,
    yahoo,
    market: "US",
    benchmark: "QQQ",
    group: "空头",
    notes: [],
    identity,
  };
}

function sessionWindow(lastCompleteYmd: string | null): string[] {
  if (!lastCompleteYmd) return [];
  const dates = [lastCompleteYmd];
  try {
    dates.push(previousUsSession(lastCompleteYmd));
  } catch {}
  return dates;
}

export async function collectSecEvidence(
  snapshot: MarketSnapshot,
): Promise<CollectorResult> {
  const items: EvidenceItem[] = [];
  const gaps: CollectorResult["gaps"] = [];
  const gap = (affectedAssets: AssetId[], message: string) => ({
    source: SOURCE_NAME,
    affectedAssets,
    capability: "FUNDAMENTAL" as const,
    blocking: true,
    message,
  });
  const window = sessionWindow(snapshot.us.lastCompleteYmd);
  if (!window.length) {
    gaps.push(gap(TARGETS, "SEC session window empty"));
    return { items, gaps, sourcesUsed: [] };
  }

  let map: Map<string, string>;
  try {
    map = await loadTickerCikMap();
  } catch {
    gaps.push(gap(TARGETS, "SEC ticker map unavailable"));
    return { items, gaps, sourcesUsed: [] };
  }
  if (!map.size) {
    gaps.push(gap(TARGETS, "SEC ticker map unavailable"));
    return { items, gaps, sourcesUsed: [] };
  }

  const master = loadSecurityMaster();
  const sourcesUsed = new Set<string>();

  for (const asset of TARGETS) {
    const underlying = master.underlyings.find((u) => u.asset === asset);
    if (!underlying) {
      gaps.push(gap([asset], `SEC underlying missing for ${asset}`));
      continue;
    }
    const item = toUniverseItem(
      underlying.id,
      underlying.yahoo,
      underlying.name,
      underlying.identity,
    );
    const cik = map.get(underlying.yahoo.toUpperCase());
    if (!cik) {
      gaps.push(gap([asset], `SEC CIK missing for ${asset}`));
      continue;
    }
    try {
      const [docs, companyFacts] = await Promise.all([
        fetchSecRecent(item, cik, window),
        getJson<CompanyFactsPayload>(
          `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
          { headers: { "User-Agent": SEC_UA, Accept: "application/json" } },
          12000,
        ),
      ]);
      sourcesUsed.add(SOURCE_NAME);
      if (!companyFacts) {
        gaps.push(gap([asset], `SEC companyfacts unavailable for ${asset}`));
      } else {
        items.push(...companyFactEvidence({
          payload: companyFacts,
          asset,
          cik,
          observedAt: snapshot.generatedAt,
          cutoff: snapshot.us.lastCompleteYmd ?? snapshot.beijingDate,
        }));
      }
      for (const doc of docs) {
        items.push({
          id: `ev-sec-${asset}-${doc.kind}-${doc.eventDate}-${doc.href.slice(-24)}`,
          asset,
          kind: doc.kind,
          observedAt: snapshot.generatedAt,
          publishedAt: doc.eventDate,
          period: doc.eventDate,
          sourceTier: 1,
          sourceName: SOURCE_NAME,
          sourceUrl: doc.href,
          title: `${asset} ${doc.title}`,
          summary: `${doc.kind} filed ${doc.eventDate}`,
          verified: true,
          stale: false,
          cluster: "COMPANY",
          signal: "CONTEXT",
          relevantAssets: [asset],
          limitations: ["Filing existence and title do not establish bearish direction"],
        });
      }
    } catch {
      gaps.push(gap([asset], `SEC fetch failed for ${asset}`));
    }
  }

  return { items, gaps, sourcesUsed: [...sourcesUsed] };
}
