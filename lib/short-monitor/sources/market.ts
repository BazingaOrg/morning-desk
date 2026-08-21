import { identityCheck, periodReturn } from "../../calc";
import { sma } from "../features";
import {
  assertHistoryBounds,
  buildShortMonitorUniverseItems,
  cutHistory,
  loadExecutionTools,
  loadSecurityMaster,
  type Underlying,
} from "../master";
import type { MarketSnapshot } from "../../shared/market-snapshot";
import type {
  DailyBar,
  QuoteSnapshot,
  SeriesBundle,
  UniverseItem,
} from "../../types";
import type { AssetId, CollectorResult, EvidenceAsset, EvidenceGap, EvidenceItem } from "../types";

const SOURCE_NAME = "Sina US daily / Tencent quote";
const SOURCE_URL =
  "https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK";

export type MarketAssetPack = {
  bars: DailyBar[];
  stale: boolean;
  session: string | null;
  dataConflict: boolean;
};

export type MarketCollection = CollectorResult & {
  assetPacks: Record<AssetId, MarketAssetPack>;
};

function emptyAssetPacks(): Record<AssetId, MarketAssetPack> {
  return {
    SPCX: { bars: [], stale: false, session: null, dataConflict: false },
    SNDK: { bars: [], stale: false, session: null, dataConflict: false },
    NASDAQ: { bars: [], stale: false, session: null, dataConflict: false },
    GOLD: { bars: [], stale: false, session: null, dataConflict: false },
  };
}

function toUniverseItem(u: Underlying): UniverseItem {
  return {
    id: u.id,
    display: u.id,
    name: u.name,
    yahoo: u.yahoo,
    market: "US",
    benchmark: u.benchmarks[0] ?? "QQQ",
    group: "空头",
    notes: u.notes.slice(),
    identity: u.identity.slice(),
  };
}

type IdentityContract = {
  expectedKind: "equity" | "etf";
  all?: string[];
  any?: string[];
  none?: string[];
  expectedSession?: string;
  expectedClose?: number;
};

export function verifyMarketIdentity(
  item: UniverseItem,
  quote: QuoteSnapshot | undefined,
  contract: IdentityContract,
): { ok: boolean; note?: string } {
  const base = identityCheck(item, quote);
  if (!base.ok) return base;
  if (
    !quote?.sourceSymbol ||
    !quote.sourceLongName ||
    !quote.sourceSecurityType
  ) {
    return { ok: false, note: "raw Tencent identity fields unavailable" };
  }
  const sourceSymbol = quote.sourceSymbol.toUpperCase();
  const expectedSymbol = item.yahoo.toUpperCase();
  if (
    sourceSymbol !== expectedSymbol &&
    !sourceSymbol.startsWith(`${expectedSymbol}.`)
  ) {
    return {
      ok: false,
      note: `source symbol "${quote.sourceSymbol}" does not match ${item.yahoo}`,
    };
  }
  const name = quote.sourceLongName.trim();
  const normalized = name.toLowerCase();
  if (
    !name ||
    (contract.all?.some(
      (token) => !normalized.includes(token.toLowerCase()),
    ) ?? false) ||
    (contract.any != null &&
      !contract.any.some((token) => normalized.includes(token.toLowerCase())))
  ) {
    return {
      ok: false,
      note: `quote name "${name || "unknown"}" does not match required identity`,
    };
  }
  if (contract.none?.some((token) => normalized.includes(token.toLowerCase()))) {
    return {
      ok: false,
      note: `quote name "${name}" matches a forbidden identity token`,
    };
  }
  const expectedSourceType = contract.expectedKind === "etf" ? "GP-ETF" : "GP";
  if (quote.sourceSecurityType !== expectedSourceType) {
    return {
      ok: false,
      note: `source security type "${quote.sourceSecurityType}" does not match ${expectedSourceType}`,
    };
  }
  if (contract.expectedSession) {
    if (quote.sourceSessionDate !== contract.expectedSession) {
      return {
        ok: false,
        note: `Tencent session "${quote.sourceSessionDate ?? "unknown"}" does not match ${contract.expectedSession}`,
      };
    }
    const sourcePrice = quote.regularMarketPrice;
    const expectedClose = contract.expectedClose;
    if (
      sourcePrice == null || expectedClose == null || expectedClose <= 0 ||
      Math.abs(sourcePrice / expectedClose - 1) > 0.05
    ) {
      return {
        ok: false,
        note: "Tencent close is missing or conflicts with the primary session close",
      };
    }
  }
  return { ok: true };
}

export function priceConfirmed(
  bars: DailyBar[],
  lastDate: string,
): boolean {
  const series = bars.filter((b) => b.date <= lastDate && b.close != null);
  if (series.length < 20) return false;
  if (!series.length || series[series.length - 1].date !== lastDate) return false;
  const closes = series.map((b) => b.close as number);
  const dma20 = sma(closes, 20);
  if (dma20 == null) return false;
  const lastClose = closes[closes.length - 1];
  if (!(lastClose < dma20)) return false;
  const ret1d = periodReturn(series, lastDate, 1, false);
  if (ret1d == null || !(ret1d < 0)) return false;
  return true;
}

export function executionToolGaps(
  asset: AssetId,
  lastDate: string,
  issues: string[],
  hasVerifiedTool: boolean,
): EvidenceGap[] {
  if (!hasVerifiedTool) {
    return [{
      source: SOURCE_NAME,
      affectedAssets: [asset],
      capability: "PRICE",
      blocking: true,
      message: `no verified execution-tool close for ${asset} on ${lastDate}${issues.length ? `: ${issues.join("; ")}` : ""}`,
    }];
  }
  return issues.map((message) => ({
    source: SOURCE_NAME,
    affectedAssets: [asset],
    capability: "PRICE",
    blocking: false,
    message,
  }));
}

function closeEvidence(
  underlying: Underlying,
  bundle: SeriesBundle,
  lastDate: string,
  observedAt: string,
): EvidenceItem | null {
  const bars = cutHistory(bundle.bars, underlying.historyStartDate);
  const series = bars.filter((b) => b.date <= lastDate && b.close != null);
  if (!series.length || series[series.length - 1].date !== lastDate) {
    return null;
  }
  const last = series[series.length - 1];
  const close = last.close as number;
  const ret1D = periodReturn(bars, lastDate, 1, false);
  const asset = underlying.asset as AssetId;
  const summaryParts = [`close=${close}`];
  if (ret1D != null) summaryParts.push(`ret1D=${ret1D}`);
  return {
    id: `ev-mkt-${underlying.id}-close`,
    asset,
    kind: "session-close",
    observedAt,
    period: lastDate,
    sourceTier: 3,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    title: `${underlying.id} close ${lastDate}`,
    value: close,
    unit: "USD",
    summary: summaryParts.join(" "),
    verified: !bundle.stale,
    stale: Boolean(bundle.stale),
    cluster: "MARKET",
    signal: "CONTEXT",
    relevantAssets: [asset],
    limitations: [
      `adjustmentMode=${bundle.adjustmentMode ?? "unknown"}`,
      ...(bundle.stale ? ["stale cache"] : []),
    ],
  };
}

function toolCloseEvidence(
  tool: ReturnType<typeof loadExecutionTools>["tools"][number],
  bundle: SeriesBundle,
  lastDate: string,
  observedAt: string,
): EvidenceItem | null {
  const series = bundle.bars.filter((bar) => bar.date <= lastDate && bar.close != null);
  if (!series.length || series.at(-1)?.date !== lastDate) return null;
  const close = series.at(-1)?.close;
  if (close == null) return null;
  return {
    id: `ev-tool-${tool.id}-close-${lastDate}`,
    asset: tool.asset as EvidenceAsset,
    kind: "execution-tool-close",
    observedAt,
    period: lastDate,
    sourceTier: 3,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    title: `${tool.id} close ${lastDate}`,
    value: close,
    unit: "USD",
    summary: `${tool.id} close=${close} on ${lastDate}`,
    verified: !bundle.stale,
    stale: Boolean(bundle.stale),
    cluster: "MARKET",
    signal: "CONTEXT",
    relevantAssets: [tool.asset as AssetId],
    limitations: [
      "Static execution-tool mapping; no account tradability, bid/ask, borrow, or live liquidity check",
      ...(bundle.stale ? ["stale cache"] : []),
    ],
  };
}

export async function collectMarketContext(
  snapshot: MarketSnapshot,
): Promise<MarketCollection> {
  const items: EvidenceItem[] = [];
  const gaps: CollectorResult["gaps"] = [];
  const assetPacks = emptyAssetPacks();
  const gap = (
    affectedAssets: Array<"SPCX" | "SNDK" | "NASDAQ" | "GOLD">,
    message: string,
  ) => ({
    source: SOURCE_NAME,
    affectedAssets,
    capability: "PRICE" as const,
    blocking: true,
    message,
  });
  const lastDate = snapshot.us.lastCompleteYmd;
  if (!lastDate) {
    gaps.push(gap(["SPCX", "SNDK", "NASDAQ", "GOLD"], "market lastCompleteYmd missing"));
    return { items, gaps, sourcesUsed: [], assetPacks };
  }

  const underlyings = loadSecurityMaster().underlyings;
  for (const u of underlyings) {
    try {
      assertHistoryBounds(u);
    } catch (err) {
      gaps.push(gap(
        [u.asset as "SPCX" | "SNDK" | "NASDAQ" | "GOLD"],
        err instanceof Error ? err.message : `history bounds failed for ${u.id}`,
      ));
    }
  }

  const universeItems = buildShortMonitorUniverseItems();
  const universeItemsById = new Map(universeItems.map((item) => [item.id, item]));
  if (!snapshot.marketSeries) {
    gaps.push(gap(
      ["SPCX", "SNDK", "NASDAQ", "GOLD"],
      "morning snapshot does not contain frozen short-monitor market series",
    ));
    return { items, gaps, sourcesUsed: [], assetPacks };
  }
  const series = new Map(Object.entries(snapshot.marketSeries));

  for (const underlying of underlyings) {
    const bundle = series.get(underlying.yahoo);
    if (!bundle || !bundle.bars.length) {
      gaps.push(gap(
        [underlying.asset as "SPCX" | "SNDK" | "NASDAQ" | "GOLD"],
        `no bars for ${underlying.id}`,
      ));
      continue;
    }
    const universeItem = toUniverseItem(underlying);
    const cut = cutHistory(bundle.bars, underlying.historyStartDate);
    if (bundle.adjustmentMode !== "adjusted") {
      assetPacks[underlying.asset as AssetId].dataConflict = true;
      gaps.push(gap(
        [underlying.asset as AssetId],
        `reliable adjusted history unavailable for ${underlying.id}`,
      ));
      continue;
    }
    const sessionClose = bundle.bars.find((bar) => bar.date === lastDate)?.close;
    const identity = verifyMarketIdentity(universeItem, bundle.quote, {
      expectedKind: underlying.kind,
      any: underlying.identity,
      expectedSession: lastDate,
      ...(sessionClose != null ? { expectedClose: sessionClose } : {}),
    });
    if (!identity.ok) {
      assetPacks[underlying.asset as AssetId].dataConflict = true;
      gaps.push(gap(
        [underlying.asset as "SPCX" | "SNDK" | "NASDAQ" | "GOLD"],
        `identity check failed for ${underlying.id}: ${identity.note ?? "unknown identity"}`,
      ));
      continue;
    }
    if (!cut.length) {
      gaps.push(gap(
        [underlying.asset as "SPCX" | "SNDK" | "NASDAQ" | "GOLD"],
        `no bars for ${underlying.id}`,
      ));
      continue;
    }
    const asset = underlying.asset as AssetId;
    assetPacks[asset] = {
      bars: cut,
      stale: Boolean(bundle.stale),
      session: cut.at(-1)?.date ?? null,
      dataConflict: false,
    };
    const ev = closeEvidence(underlying, bundle, lastDate, snapshot.generatedAt);
    if (!ev) {
      gaps.push(gap(
        [underlying.asset as "SPCX" | "SNDK" | "NASDAQ" | "GOLD"],
        `no session bar for ${underlying.id} on ${lastDate}`,
      ));
      continue;
    }
    items.push(ev);
  }

  const tools = loadExecutionTools().tools;
  const toolIssues = new Map<AssetId, string[]>();
  const recordToolIssue = (asset: AssetId, message: string) => {
    toolIssues.set(asset, [...(toolIssues.get(asset) ?? []), message]);
  };
  for (const tool of tools) {
    const bundle = series.get(tool.yahoo);
    if (!bundle || !bundle.bars.length) {
      recordToolIssue(tool.asset as AssetId, `no bars for execution tool ${tool.id}`);
      continue;
    }
    const toolItem = universeItemsById.get(tool.id);
    const sessionClose = bundle.bars.find((bar) => bar.date === lastDate)?.close;
    const identity = toolItem
      ? verifyMarketIdentity(toolItem, bundle.quote, {
          expectedKind: "etf",
          all: tool.identityAll,
          none: tool.identityNone,
          expectedSession: lastDate,
          ...(sessionClose != null ? { expectedClose: sessionClose } : {}),
        })
      : { ok: false, note: "tool missing from market universe" };
    if (!identity.ok) {
      recordToolIssue(
        tool.asset as AssetId,
        `identity check failed for execution tool ${tool.id}: ${identity.note ?? "unknown identity"}`,
      );
      continue;
    }
    const evidence = toolCloseEvidence(tool, bundle, lastDate, snapshot.generatedAt);
    if (evidence) {
      items.push(evidence);
    } else {
      recordToolIssue(
        tool.asset as AssetId,
        `no session bar for execution tool ${tool.id} on ${lastDate}`,
      );
    }
  }

  for (const asset of ["SPCX", "SNDK", "NASDAQ", "GOLD"] as const) {
    const hasTool = items.some(
      (item) =>
        item.asset === asset &&
        item.kind === "execution-tool-close" &&
        item.verified &&
        !item.stale,
    );
    gaps.push(...executionToolGaps(asset, lastDate, toolIssues.get(asset) ?? [], hasTool));
  }

  return {
    items,
    gaps,
    sourcesUsed: items.length || gaps.length ? [SOURCE_NAME] : [],
    assetPacks,
  };
}

export async function collectMarketEvidence(
  snapshot: MarketSnapshot,
): Promise<CollectorResult> {
  const result = await collectMarketContext(snapshot);
  return {
    items: result.items,
    gaps: result.gaps,
    sourcesUsed: result.sourcesUsed,
  };
}
