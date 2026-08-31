import type { SessionFreshness } from "./shared/session";

export type Market = "US" | "HK";

export type VolumeClass =
  | "明显放量"
  | "温和放量"
  | "正常"
  | "温和缩量"
  | "明显缩量";

export type RowTag = "数据异常" | "重点关注" | "明显走强" | "正常";

export interface UniverseItem {
  id: string;
  display: string;
  name: string;
  yahoo: string;
  market: Market;
  benchmark: string;
  group: string;
  notes: string[];
  identity: string[];
  limitedExcess?: boolean;
}

export interface DailyBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
}

export interface SplitEvent {
  date: string;
  ratio: string;
}

export interface DividendEvent {
  date: string;
  amount: number;
}

export interface QuoteSnapshot {
  yahoo: string;
  symbol: string;
  sourceSymbol?: string;
  shortName?: string;
  longName?: string;
  sourceLongName?: string;
  sourceSecurityType?: string;
  quoteType?: string;
  exchange?: string;
  currency?: string;
  marketState?: string;
  exchangeTimezoneName?: string;
  regularMarketTime?: string;
  regularMarketPrice?: number;
  sourceSessionDate?: string;
  firstTradeDate?: string;
  tradeable?: boolean;
}

export interface SeriesBundle {
  item: UniverseItem;
  quote?: QuoteSnapshot;
  bars: DailyBar[];
  splits: SplitEvent[];
  dividends: DividendEvent[];
  error?: string;
  stale?: boolean;
  staleError?: string;
  lastSuccessAt?: string;
  adjustmentMode?: "unadjusted" | "forward-adjusted" | "adjusted";
}

export interface SecurityRow {
  id: string;
  display: string;
  name: string;
  yahoo: string;
  market: Market;
  group: string;
  currency?: string;
  close: number | null;
  ret1D: number | null;
  ret5D: number | null;
  ret10D: number | null;
  ret20D: number | null;
  retYtd: number | null;
  sinceListing: number | null;
  ytdLabel: "YTD" | "上市以来";
  excess10D: number | null;
  volumeRatio: number | null;
  volumeClass: VolumeClass | null;
  dist52W: number | null;
  tag: RowTag;
  sessionDate: string | null;
  listed: boolean;
  halted: boolean;
  identityOk: boolean;
  identityNote?: string;
  splitNote?: string;
  usedAdjusted: boolean;
  notes: string[];
  limitedExcess?: boolean;
  moverReasons: string[];
  sources: { label: string; href: string }[];
}

export interface MoverLine {
  id: string;
  display: string;
  name: string;
  ret1D: number | null;
  ret10D: number | null;
  excess10D: number | null;
  volumeRatio: number | null;
  nature: string;
  reason: string;
  reasonHref?: string;
  tag: RowTag;
}

export interface Catalyst {
  id: string;
  display: string;
  name: string;
  kind: string;
  date: string;
  confirmed: boolean;
  detail: string;
  href?: string;
}

export interface MarketStamp {
  market: Market;
  sessionDate: string | null;
  isNew: boolean;
  closed: boolean;
  label: string;
  freshness?: SessionFreshness;
}

export interface Chop {
  key: string;
  title: string;
  value: string;
  tone: "calm" | "alert" | "strong" | "idle";
}

export interface DailyReport {
  title: string;
  beijingDate: string;
  generatedAt: string;
  timezone: "Asia/Shanghai";
  closedBoth: boolean;
  closedNote?: string;
  us: MarketStamp;
  hk: MarketStamp;
  chops: Chop[];
  conclusion: string[];
  movers: MoverLine[];
  usRows: SecurityRow[];
  hkRows: SecurityRow[];
  catalysts: Catalyst[];
  audit: {
    generatedAt: string;
    sources: string[];
    gaps: string[];
    holidays: string[];
    identityFlags: string[];
    unfinished: string[];
  };
}

export interface GenerateState {
  lastBeijingDate?: string;
  lastUsSession?: string | null;
  lastHkSession?: string | null;
}

export interface UniversePayload {
  items: UniverseItem[];
  pendingIds: string[];
  reportIds: string[];
  referencedBenchmarks: string[];
  staleStats: boolean;
}

export type SearchScope = "all" | "tracked" | "us" | "hk";

export interface SearchHit {
  id: string;
  display: string;
  name: string;
  yahoo: string;
  market: Market;
  tracked: boolean;
  source: "universe" | "sec" | "hkex" | "quote";
}

export interface SearchResult {
  hits: SearchHit[];
  note?: string;
}

export interface UniversePreviewResult {
  item: UniverseItem;
  tracked: boolean;
  benchmarks: readonly string[];
}
