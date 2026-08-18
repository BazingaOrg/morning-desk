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
import { beijingDate } from "./time";
import { UNIVERSE, yahooSymbols } from "./universe";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const SINA_K = "https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK";
const TX_HK = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const TX_QT = "https://qt.gtimg.cn/q=";

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

async function fetchText(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.arrayBuffer();
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
  code: string;
  price: string;
  time: string;
}

function parseTxQuotes(raw: string): Map<string, TxQuote> {
  const map = new Map<string, TxQuote>();
  for (const chunk of raw.split(";")) {
    const m = chunk.match(/v_([^=]+)="(.*)"/);
    if (!m) continue;
    const p = m[2].split("~");
    map.set(m[1], { name: p[1] ?? "", code: p[2] ?? "", price: p[3] ?? "", time: p[30] ?? "" });
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
): QuoteSnapshot {
  return {
    yahoo,
    symbol: yahoo,
    shortName: q?.name || undefined,
    longName: q?.name || undefined,
    quoteType: market === "HK" || yahoo.length <= 5 ? "EQUITY" : "ETF",
    exchange: market === "HK" ? "HKG" : "US",
    currency: market === "HK" ? "HKD" : "USD",
    marketState: flags ? phaseFromFlags(flags, market) : "CLOSED",
    exchangeTimezoneName: market === "HK" ? "Asia/Hong_Kong" : "America/New_York",
    regularMarketTime: parseLooseTime(q?.time),
    firstTradeDate: first,
    tradeable: true,
  };
}

export async function fetchUniverseSeries(
  quotes: Map<string, QuoteSnapshot>,
): Promise<Map<string, SeriesBundle>> {
  const items: UniverseItem[] = UNIVERSE;
  const extra = yahooSymbols().filter((s) => !items.some((i) => i.yahoo === s));
  const allYahoo = [...new Set(["VOO", "2800.HK", ...items.map((i) => i.yahoo), ...extra])];

  let txQuotes = new Map<string, TxQuote>();
  let flags = "";
  try {
    const batch = await fetchQuoteMap(allYahoo);
    txQuotes = batch.quotes;
    flags = batch.flags;
  } catch {}

  const bundles = new Map<string, SeriesBundle>();

  for (const yahoo of allYahoo) {
    const item =
      items.find((i) => i.yahoo === yahoo) ??
      ({
        id: yahoo,
        display: yahoo,
        name: yahoo,
        yahoo,
        market: yahoo.endsWith(".HK") ? "HK" : "US",
        benchmark: "",
        group: "基准",
        notes: [],
        identity: [],
      } satisfies UniverseItem);

    const cached = await readCache(yahoo);
    if (cached && cached.beijingDate === beijingDate() && cached.bars.length) {
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
      });
      continue;
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
        txQuotes.get(tencentCode(yahoo)) ??
          (pack.name ? { name: pack.name, code: yahoo, price: "", time: "" } : undefined),
        pack.flags || flags,
        bars[0]?.date,
      );
      quotes.set(yahoo, q);
      const stored: CachedChart = {
        fetchedAt: new Date().toISOString(),
        beijingDate: beijingDate(),
        quote: q,
        bars,
        splits,
        dividends,
      };
      await writeCache(yahoo, stored);
      bundles.set(yahoo, { item, quote: q, bars, splits, dividends });
    } catch (error) {
      if (cached?.bars.length) {
        quotes.set(yahoo, cached.quote);
        bundles.set(yahoo, {
          item,
          quote: cached.quote,
          bars: cached.bars,
          splits: cached.splits,
          dividends: cached.dividends,
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

  return bundles;
}
