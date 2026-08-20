import { promises as fs } from "node:fs";
import path from "node:path";
import { searchHkexPrefix } from "./facts/hkex";
import { loadUniverse } from "./store";
import type { Market, SearchHit, SearchResult, SearchScope, UniverseItem } from "./types";
import { BENCHMARKS, HK_REF, US_REF } from "./universe";
import { probeQuote } from "./yahoo";

const SEC_CACHE = path.join(process.cwd(), "data", "cache", "sec-tickers.json");
const HK_TECH = /互联网|科技|小米|快手|腾讯|美团|阿里|京东|网易|携程|哔哩/;

type SecRow = { ticker: string; title: string; cik_str: number };

let secMem: { beijingDate: string; rows: SecRow[] } | null = null;

async function loadSecRows(): Promise<SecRow[] | null> {
  try {
    const raw = JSON.parse(await fs.readFile(SEC_CACHE, "utf8")) as {
      beijingDate: string;
      rows: SecRow[];
    };
    if (secMem && secMem.beijingDate === raw.beijingDate) return secMem.rows;
    secMem = { beijingDate: raw.beijingDate, rows: raw.rows };
    return secMem.rows;
  } catch {
    return null;
  }
}

function isAShare(q: string): boolean {
  const u = q.toUpperCase();
  if (/\.(SZ|SS|SH)$/.test(u)) return true;
  return /^\d{6}$/.test(q);
}

function isHkCode(q: string): boolean {
  return /^\d{1,5}(\.HK)?$/i.test(q);
}

function isUsTicker(q: string): boolean {
  return /^[A-Za-z][A-Za-z0-9.-]{0,6}$/.test(q);
}

function isHkDerivative(name: string, code: string): boolean {
  if (/购|沽|窩輪|窝轮|界内证|牛证|熊证|认购|认沽/.test(name)) return true;
  const n = Number(code);
  return Number.isFinite(n) && n >= 10000;
}

export function mapUsTicker(raw: string): { id: string; display: string; yahoo: string } {
  const yahoo = raw.toUpperCase();
  const id = yahoo.replace(/-/g, ".");
  return { id, display: id, yahoo };
}

export function mapHkCode(raw: string): { id: string; display: string; yahoo: string } {
  const digits = raw.replace(/\.HK$/i, "");
  const id = digits.padStart(5, "0");
  return { id, display: `${id}.HK`, yahoo: `${Number(digits)}.HK` };
}

function identityFromName(name: string): string[] {
  const out = [name];
  const tokens = name.split(/[\s,./\-_|（）()]+/).filter((t) => t.length >= 2);
  for (const token of tokens.slice(0, 2)) {
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

export function defaultBenchmark(market: Market, name: string): string {
  if (market === "US") return US_REF;
  return HK_TECH.test(name) ? "3033.HK" : HK_REF;
}

export function proposeUniverseItem(
  market: Market,
  yahoo: string,
  name: string,
): UniverseItem {
  if (market === "HK") {
    const norm = mapHkCode(yahoo.replace(/\.HK$/i, ""));
    return {
      id: norm.id,
      display: norm.display,
      name,
      yahoo: norm.yahoo,
      market: "HK",
      benchmark: defaultBenchmark("HK", name),
      group: "未分组",
      notes: [],
      identity: identityFromName(name),
    };
  }
  const norm = mapUsTicker(yahoo);
  return {
    id: norm.id,
    display: norm.display,
    name,
    yahoo: norm.yahoo,
    market: "US",
    benchmark: defaultBenchmark("US", name),
    group: "未分组",
    notes: [],
    identity: identityFromName(name),
  };
}

export function isAllowedBenchmark(
  benchmark: string,
  items: UniverseItem[],
): boolean {
  if ((BENCHMARKS as readonly string[]).includes(benchmark)) return true;
  if (benchmark === US_REF || benchmark === HK_REF) return true;
  return items.some((item) => item.yahoo === benchmark);
}

function trackedMatch(item: UniverseItem, q: string, qLower: string): boolean {
  if (item.id.toLowerCase() === qLower) return true;
  if (item.display.toLowerCase() === qLower) return true;
  if (item.yahoo.toLowerCase() === qLower) return true;
  if (item.id.toLowerCase().includes(qLower)) return true;
  if (item.display.toLowerCase().includes(qLower)) return true;
  if (item.yahoo.toLowerCase().includes(qLower)) return true;
  if (item.name.toLowerCase().includes(qLower)) return true;
  return item.identity.some((token) => token.toLowerCase().includes(qLower));
}

function rankHit(hit: SearchHit, qLower: string): number {
  let score = 0;
  if (hit.tracked) score += 1000;
  const idL = hit.id.toLowerCase();
  const yahooL = hit.yahoo.toLowerCase();
  const displayL = hit.display.toLowerCase();
  if (idL === qLower || yahooL === qLower || displayL === qLower) score += 400;
  else if (
    idL.startsWith(qLower) ||
    yahooL.startsWith(qLower) ||
    displayL.startsWith(qLower)
  ) {
    score += 200;
  } else if (hit.name.toLowerCase().includes(qLower)) {
    score += 50;
  }
  return score;
}

function pushUnique(hits: SearchHit[], hit: SearchHit) {
  if (hits.some((h) => h.yahoo === hit.yahoo)) return;
  hits.push(hit);
}

export async function searchUniverse(
  qRaw: string,
  scope: SearchScope = "all",
): Promise<SearchResult> {
  const q = qRaw.trim();
  if (!q) return { hits: [] };

  if (isAShare(q)) {
    return { hits: [], note: "不含 A 股" };
  }

  const qLower = q.toLowerCase();
  const hkQuery = isHkCode(q);
  const usQuery = isUsTicker(q);
  const wantUs = scope === "all" || scope === "us";
  const wantHk = scope === "all" || scope === "hk";

  const universe = await loadUniverse();
  const trackedYahoo = new Set(universe.map((item) => item.yahoo));
  const trackedIds = new Set(universe.map((item) => item.id));
  const hits: SearchHit[] = [];

  for (const item of universe) {
    if (scope === "us" && item.market !== "US") continue;
    if (scope === "hk" && item.market !== "HK") continue;
    if (!trackedMatch(item, q, qLower)) continue;
    pushUnique(hits, {
      id: item.id,
      display: item.display,
      name: item.name,
      yahoo: item.yahoo,
      market: item.market,
      tracked: true,
      source: "universe",
    });
  }

  if (wantUs && !hkQuery) {
    const rows = await loadSecRows();
    if (rows) {
      const upper = q.toUpperCase();
      for (const row of rows) {
        const ticker = row.ticker.toUpperCase();
        const title = row.title ?? "";
        let ok = false;
        if (usQuery) {
          ok = ticker === upper || ticker.startsWith(upper);
        } else {
          ok =
            ticker === upper ||
            ticker.startsWith(upper) ||
            title.toLowerCase().includes(qLower);
        }
        if (!ok) continue;
        const mapped = mapUsTicker(ticker);
        pushUnique(hits, {
          id: mapped.id,
          display: mapped.display,
          name: title || mapped.id,
          yahoo: mapped.yahoo,
          market: "US",
          tracked: trackedYahoo.has(mapped.yahoo) || trackedIds.has(mapped.id),
          source: "sec",
        });
        if (hits.length >= 40) break;
      }
    }
  }

  if (wantHk && !usQuery) {
    const prefix = hkQuery ? q.replace(/\.HK$/i, "") : q;
    try {
      const hkHits = await searchHkexPrefix(prefix);
      for (const row of hkHits) {
        if (!hkQuery && isHkDerivative(row.name, row.code)) continue;
        const mapped = mapHkCode(row.code);
        pushUnique(hits, {
          id: mapped.id,
          display: mapped.display,
          name: row.name || mapped.display,
          yahoo: mapped.yahoo,
          market: "HK",
          tracked: trackedYahoo.has(mapped.yahoo) || trackedIds.has(mapped.id),
          source: "hkex",
        });
      }
    } catch {}
  }

  if (wantUs && usQuery) {
    const mapped = mapUsTicker(q);
    if (!hits.some((h) => h.yahoo === mapped.yahoo)) {
      const quote = await probeQuote(mapped.yahoo);
      if (quote) {
        pushUnique(hits, {
          id: mapped.id,
          display: mapped.display,
          name: quote.name,
          yahoo: mapped.yahoo,
          market: "US",
          tracked: trackedYahoo.has(mapped.yahoo) || trackedIds.has(mapped.id),
          source: "quote",
        });
      }
    }
  }

  hits.sort((a, b) => rankHit(b, qLower) - rankHit(a, qLower));
  return { hits: hits.slice(0, 10) };
}

export { BENCHMARKS };
