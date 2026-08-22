import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DailyBar,
  DividendEvent,
  QuoteSnapshot,
  SeriesBundle,
  SplitEvent,
  UniverseItem,
} from "./types";
import { cacheHasCompleteSession, beijingDate, HK_TZ, lastCompleteSessionDate, US_TZ, ymdInZone } from "./time";
import { yahooSymbols } from "./universe";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const SINA_K = "https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK";
const TX_HK = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const TX_QT = "https://qt.gtimg.cn/q=";
export const MARKET_DATA_REQUEST_TIMEOUT_MS = 15_000;
export const MARKET_DATA_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

export interface FetchTextOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

class MarketDataFetchError extends Error {}

function asError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tencentCode(yahoo: string): string {
  if (yahoo.endsWith(".HK")) {
    return `hk${yahoo.replace(".HK", "").padStart(5, "0")}`;
  }
  if (yahoo === "BRK-B") return "usBRK.B";
  return `us${yahoo}`;
}

export function sinaCode(yahoo: string): string {
  if (yahoo === "BRK-B") return "brk.b";
  return yahoo.toLowerCase();
}

interface CachedChart {
  fetchedAt: string;
  beijingDate: string;
  quote: QuoteSnapshot;
  bars: DailyBar[];
  splits: SplitEvent[];
  dividends: DividendEvent[];
  adjustmentMode?: "unadjusted" | "forward-adjusted" | "adjusted";
}

function cachePath(symbol: string): string {
  return path.join(CACHE_DIR, `${symbol.replace(/[^\w.-]+/g, "_")}.json`);
}

async function readCache(symbol: string): Promise<CachedChart | null> {
  try {
    return JSON.parse(await fs.readFile(cachePath(symbol), "utf8")) as CachedChart;
  } catch {
    return null;
  }
}

async function writeCache(symbol: string, data: CachedChart): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(symbol), JSON.stringify(data));
}

function adjustedCachePath(symbol: string): string {
  return cachePath(`${symbol}.adjusted`);
}

export async function readAdjustedCache(symbol: string): Promise<CachedChart | null> {
  try {
    return JSON.parse(await fs.readFile(adjustedCachePath(symbol), "utf8")) as CachedChart;
  } catch {
    return null;
  }
}

export async function writeAdjustedCache(symbol: string, data: CachedChart): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(adjustedCachePath(symbol), JSON.stringify(data));
}

function keepContiguous(bars: DailyBar[]): DailyBar[] {
  if (bars.length < 2) return bars;
  let cut = 0;
  for (let i = 1; i < bars.length; i += 1) {
    const prev = Date.parse(`${bars[i - 1].date}T00:00:00Z`);
    const cur = Date.parse(`${bars[i].date}T00:00:00Z`);
    const gap = (cur - prev) / 86_400_000;
    if (gap > 30) cut = i;
  }
  return bars.slice(cut);
}

function detectSplits(bars: DailyBar[]): SplitEvent[] {
  const out: SplitEvent[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const a = bars[i - 1].close;
    const b = bars[i].close;
    if (a === null || b === null || a === 0) continue;
    const move = b / a;
    if (move <= 0.55 || move >= 1.8) {
      out.push({ date: bars[i].date, ratio: `${move.toFixed(2)}x` });
    }
  }
  return out;
}

export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<ArrayBuffer> {
  const timeoutMs = options.timeoutMs ?? MARKET_DATA_REQUEST_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MARKET_DATA_RESPONSE_MAX_BYTES;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid market data timeout");
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("Invalid market data response limit");

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await (options.fetchImpl ?? fetch)(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new MarketDataFetchError(`Market data request returned HTTP ${res.status}`);

    const contentLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new MarketDataFetchError("Market data response exceeded the size limit");
    }
    if (!res.body) return new ArrayBuffer(0);

    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new MarketDataFetchError("Market data response exceeded the size limit");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  } catch (error) {
    if (error instanceof MarketDataFetchError) throw error;
    if (timedOut || controller.signal.aborted) throw new Error("Market data request timed out");
    throw new Error("Market data request failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUsBars(yahoo: string): Promise<DailyBar[]> {
  const url = `${SINA_K}?symbol=${encodeURIComponent(sinaCode(yahoo))}`;
  const text = new TextDecoder("utf-8").decode(await fetchText(url));
  const rows = JSON.parse(text) as Array<{ d: string; o: string; h: string; l: string; c: string; v: string }>;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`新浪无日线：${yahoo}`);
  const bars: DailyBar[] = rows.map((r) => ({
    date: r.d,
    open: Number(r.o),
    high: Number(r.h),
    low: Number(r.l),
    close: Number(r.c),
    adjClose: Number(r.c),
    volume: Number(r.v),
  }));
  return keepContiguous(bars.filter((b) => Number.isFinite(b.close)));
}

type YahooChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
      events?: {
        splits?: Record<string, { date?: number; numerator?: number; denominator?: number; splitRatio?: string }>;
        dividends?: Record<string, { date?: number; amount?: number }>;
      };
    }>;
    error?: unknown;
  };
};

export async function fetchAdjustedUsSeries(yahoo: string, options: FetchTextOptions = {}): Promise<{
  bars: DailyBar[];
  splits: SplitEvent[];
  dividends: DividendEvent[];
}> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}` +
    "?range=2y&interval=1d&events=div%2Csplits&includeAdjustedClose=true";
  const payload = JSON.parse(
    new TextDecoder("utf-8").decode(await fetchText(url, options)),
  ) as YahooChartPayload;
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!timestamps?.length || !quote || !adjusted) {
    throw new Error(`Adjusted market data unavailable for ${yahoo}`);
  }
  const bars = timestamps.flatMap((timestamp, index): DailyBar[] => {
    const close = quote.close?.[index];
    const adjClose = adjusted[index];
    if (close == null || adjClose == null || !Number.isFinite(close) || !Number.isFinite(adjClose)) {
      return [];
    }
    const date = ymdInZone(new Date(timestamp * 1000), US_TZ);
    const factor = adjClose / close;
    const adjustedPrice = (value: number | null | undefined) =>
      value == null || !Number.isFinite(value) ? null : value * factor;
    return [{
      date,
      open: adjustedPrice(quote.open?.[index]),
      high: adjustedPrice(quote.high?.[index]),
      low: adjustedPrice(quote.low?.[index]),
      close: adjClose,
      adjClose,
      volume: quote.volume?.[index] ?? null,
    }];
  });
  if (!bars.length) throw new Error(`Adjusted market data unavailable for ${yahoo}`);
  const splits = Object.values(result.events?.splits ?? {}).flatMap((event): SplitEvent[] => {
    if (!event.date) return [];
    const ratio = event.splitRatio ??
      (event.numerator && event.denominator ? `${event.numerator}:${event.denominator}` : "unknown");
    return [{ date: ymdInZone(new Date(event.date * 1000), US_TZ), ratio }];
  });
  const dividends = Object.values(result.events?.dividends ?? {}).flatMap((event): DividendEvent[] => {
    if (!event.date || event.amount == null || !Number.isFinite(event.amount)) return [];
    return [{ date: ymdInZone(new Date(event.date * 1000), US_TZ), amount: event.amount }];
  });
  return { bars, splits, dividends };
}

async function fetchHkBars(yahoo: string): Promise<{ bars: DailyBar[]; name?: string; flags?: string }> {
  const code = tencentCode(yahoo);
  const url = `${TX_HK}?param=${code},day,,,400,qfq`;
  const payload = JSON.parse(new TextDecoder("utf-8").decode(await fetchText(url))) as {
    data?: Record<string, { day?: string[][]; qt?: Record<string, unknown> }>;
  };
  const pack = payload.data?.[code];
  if (!pack?.day?.length) throw new Error(`腾讯无日线：${yahoo}`);
  const bars: DailyBar[] = pack.day.map((row) => ({
    date: String(row[0]),
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]),
    adjClose: Number(row[2]),
  }));
  const qt = pack.qt?.[code];
  const name = Array.isArray(qt) ? String(qt[1] ?? "") : undefined;
  const flags = Array.isArray(pack.qt?.market) ? String(pack.qt?.market[0] ?? "") : undefined;
  return { bars: keepContiguous(bars.filter((b) => Number.isFinite(b.close as number))), name, flags };
}

interface TxQuote {
  name: string;
  longName: string;
  code: string;
  price: string;
  time: string;
  securityType: string;
}

function parseTxQuotes(raw: string): Map<string, TxQuote> {
  const map = new Map<string, TxQuote>();
  for (const chunk of raw.split(";")) {
    const m = chunk.match(/v_([^=]+)="(.*)"/);
    if (!m) continue;
    const p = m[2].split("~");
    map.set(m[1], {
      name: p[1] ?? "",
      longName: p[46] ?? "",
      code: p[2] ?? "",
      price: p[3] ?? "",
      time: p[30] ?? "",
      securityType: p[56] ?? "",
    });
  }
  return map;
}

function phaseFromFlags(flags: string, market: "US" | "HK"): string {
  const key = market === "US" ? "US" : "HK";
  const hit = flags.match(new RegExp(`${key}_([^|]+)`))?.[1] ?? "";
  if (hit.includes("交易中") || hit.startsWith("open")) return "REGULAR";
  if (hit.includes("午间")) return "REGULAR";
  if (hit.includes("未开盘")) return "PRE";
  return "CLOSED";
}

async function fetchQuoteMap(yahoos: string[]): Promise<{ quotes: Map<string, TxQuote>; flags: string }> {
  const codes = [...new Set(yahoos.map(tencentCode))];
  const url = TX_QT + codes.join(",");
  const buf = await fetchText(url);
  const text = new TextDecoder("gb18030").decode(buf);
  const quotes = parseTxQuotes(text);
  const flagsMatch = text.match(/US_[^"|]+|HK_[^"|]+/g);
  return { quotes, flags: flagsMatch?.join("|") ?? "" };
}

export async function probeQuote(yahoo: string): Promise<{ name: string } | null> {
  try {
    const { quotes } = await fetchQuoteMap([yahoo]);
    const name = quotes.get(tencentCode(yahoo))?.name?.trim();
    if (!name) return null;
    return { name };
  } catch {
    return null;
  }
}

function parseLooseTime(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const isoish = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const direct = new Date(isoish);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const east = new Date(`${isoish}+08:00`);
  if (!Number.isNaN(east.getTime())) return east.toISOString();
  return undefined;
}

function snapshot(
  yahoo: string,
  market: "US" | "HK",
  q?: TxQuote,
  flags?: string,
  first?: string,
  fallbackName?: string,
): QuoteSnapshot {
  const sourceSecurityType = q?.securityType.trim();
  const quoteType =
    sourceSecurityType === "GP-ETF"
      ? "ETF"
      : sourceSecurityType === "GP"
        ? "EQUITY"
        : "NONE";
  return {
    yahoo,
    symbol: q?.code || yahoo,
    sourceSymbol: q?.code || undefined,
    shortName: q?.name || fallbackName || undefined,
    longName: q?.longName || undefined,
    sourceLongName: q?.longName || undefined,
    sourceSecurityType: sourceSecurityType || undefined,
    quoteType,
    exchange: market === "HK" ? "HKG" : "US",
    currency: market === "HK" ? "HKD" : "USD",
    marketState: flags ? phaseFromFlags(flags, market) : "CLOSED",
    exchangeTimezoneName: market === "HK" ? "Asia/Hong_Kong" : "America/New_York",
    regularMarketTime: parseLooseTime(q?.time),
    regularMarketPrice:
      q?.price && Number.isFinite(Number(q.price)) ? Number(q.price) : undefined,
    sourceSessionDate: q?.time.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/)?.slice(1, 4).join("-"),
    firstTradeDate: first,
    tradeable: true,
  };
}

function placeholderItem(yahoo: string): UniverseItem {
  return {
    id: yahoo,
    display: yahoo,
    name: yahoo,
    yahoo,
    market: yahoo.endsWith(".HK") ? "HK" : "US",
    benchmark: "",
    group: "基准",
    notes: [],
    identity: [],
  };
}

function hasSessionBar(bars: { date: string }[], session: string | null): boolean {
  if (!session) return bars.length > 0;
  return bars.some((bar) => bar.date === session);
}

export async function fetchUniverseSeries(
  quotes: Map<string, QuoteSnapshot>,
  items: UniverseItem[],
  barsSkip?: ReadonlySet<string>,
): Promise<Map<string, SeriesBundle>> {
  const extra = yahooSymbols(items).filter((s) => !items.some((i) => i.yahoo === s));
  const allYahoo = [...new Set(["VOO", "QQQ", "2800.HK", "2823.HK", ...items.map((i) => i.yahoo), ...extra])];

  let txQuotes = new Map<string, TxQuote>();
  let flags = "";
  try {
    const batch = await fetchQuoteMap(allYahoo);
    txQuotes = batch.quotes;
    flags = batch.flags;
  } catch {}

  const bundles = new Map<string, SeriesBundle>();

  function expectedSession(market: "US" | "HK"): string | null {
    const ref = bundles.get(market === "HK" ? "2800.HK" : "VOO");
    const tz = market === "HK" ? HK_TZ : US_TZ;
    return lastCompleteSessionDate(ref?.bars.map((bar) => bar.date) ?? [], tz);
  }

  async function loadOne(yahoo: string, allowCache: boolean): Promise<void> {
    const item = items.find((i) => i.yahoo === yahoo) ?? placeholderItem(yahoo);
    if (barsSkip?.has(yahoo)) {
      const q = snapshot(
        yahoo,
        item.market,
        txQuotes.get(tencentCode(yahoo)),
        flags,
        undefined,
      );
      quotes.set(yahoo, q);
      bundles.set(yahoo, {
        item,
        quote: q,
        bars: [],
        splits: [],
        dividends: [],
      });
      return;
    }
    const cached = await readCache(yahoo);
    const expected = expectedSession(item.market);
    const cacheOk =
      allowCache &&
      cached &&
      cacheHasCompleteSession(cached.bars, item.market === "HK" ? HK_TZ : US_TZ, cached.beijingDate) &&
      hasSessionBar(cached.bars, expected);

    if (cacheOk && cached) {
      const q = snapshot(
        yahoo,
        item.market,
        txQuotes.get(tencentCode(yahoo)),
        flags,
        cached.bars[0]?.date,
      );
      quotes.set(yahoo, q);
      bundles.set(yahoo, {
        item,
        quote: q,
        bars: cached.bars,
        splits: cached.splits,
        dividends: cached.dividends,
        adjustmentMode: cached.adjustmentMode ?? (item.market === "HK" ? "forward-adjusted" : "unadjusted"),
      });
      return;
    }

    try {
      const pack =
        item.market === "HK" ? await fetchHkBars(yahoo) : { bars: await fetchUsBars(yahoo) };
      const bars = pack.bars;
      const splits =
        item.market === "US" && !item.inverse ? detectSplits(bars.slice(-260)) : [];
      const dividends: DividendEvent[] = [];
      const q = snapshot(
        yahoo,
        item.market,
        txQuotes.get(tencentCode(yahoo)),
        pack.flags || flags,
        bars[0]?.date,
        pack.name,
      );
      quotes.set(yahoo, q);
      const adjustmentMode = item.market === "HK" ? "forward-adjusted" as const : "unadjusted" as const;
      bundles.set(yahoo, { item, quote: q, bars, splits, dividends, adjustmentMode });
      if (!expected || hasSessionBar(bars, expected)) {
        await writeCache(yahoo, {
          fetchedAt: new Date().toISOString(),
          beijingDate: beijingDate(),
          quote: q,
          bars,
          splits,
          dividends,
          adjustmentMode,
        });
      }
    } catch (error) {
      if (cached?.bars.length) {
        quotes.set(yahoo, cached.quote);
        bundles.set(yahoo, {
          item,
          quote: cached.quote,
          bars: cached.bars,
          splits: cached.splits,
          dividends: cached.dividends,
          stale: true,
          staleError: error instanceof Error ? error.message : String(error),
          lastSuccessAt: cached.fetchedAt,
          adjustmentMode: cached.adjustmentMode ?? (item.market === "HK" ? "forward-adjusted" : "unadjusted"),
        });
      } else {
        bundles.set(yahoo, {
          item,
          quote: quotes.get(yahoo),
          bars: [],
          splits: [],
          dividends: [],
          error: asError(error),
        });
      }
    }
    await sleep(60);
  }

  for (const yahoo of allYahoo) {
    await loadOne(yahoo, true);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stale = allYahoo.filter((yahoo) => {
      const bundle = bundles.get(yahoo);
      const market = bundle?.item.market ?? (yahoo.endsWith(".HK") ? "HK" : "US");
      const expected = expectedSession(market);
      if (!expected) return false;
      return !hasSessionBar(bundle?.bars ?? [], expected);
    });
    if (!stale.length) break;
    await sleep(1500);
    for (const yahoo of stale) {
      await loadOne(yahoo, false);
    }
  }

  return bundles;
}
