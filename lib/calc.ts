import type {
  DailyBar,
  InverseStats,
  QuoteSnapshot,
  ReviewLevel,
  RowTag,
  SecurityRow,
  SeriesBundle,
  ThesisRecord,
  ThesisStatus,
  UniverseItem,
  VolumeClass,
} from "./types";
import { sourceLinks } from "./universe";

export function classifyVolume(ratio: number | null): VolumeClass | null {
  if (ratio === null || Number.isNaN(ratio)) return null;
  if (ratio >= 1.5) return "明显放量";
  if (ratio >= 1.2) return "温和放量";
  if (ratio >= 0.8) return "正常";
  if (ratio >= 0.6) return "温和缩量";
  return "明显缩量";
}

export function completeBars(bars: DailyBar[], lastDate: string): DailyBar[] {
  return bars.filter((b) => b.date <= lastDate && b.close !== null);
}

export function sessionBars(bars: DailyBar[], lastDate: string): DailyBar[] {
  const series = completeBars(bars, lastDate);
  if (!series.length || series[series.length - 1].date !== lastDate) return [];
  return series;
}

function closeOf(bar: DailyBar, adjusted: boolean): number | null {
  if (adjusted) return bar.adjClose ?? bar.close;
  return bar.close;
}

export function periodReturn(
  bars: DailyBar[],
  lastDate: string,
  sessions: number,
  adjusted: boolean,
): number | null {
  const series = sessionBars(bars, lastDate);
  if (series.length < sessions + 1) return null;
  const last = closeOf(series[series.length - 1], adjusted);
  const prev = closeOf(series[series.length - 1 - sessions], adjusted);
  if (last === null || prev === null || prev === 0) return null;
  return last / prev - 1;
}

export function ytdReturn(
  bars: DailyBar[],
  lastDate: string,
  adjusted: boolean,
): { ytd: number | null; sinceListing: number | null; label: "YTD" | "上市以来" } {
  const series = sessionBars(bars, lastDate);
  if (series.length < 2) {
    return { ytd: null, sinceListing: null, label: "YTD" };
  }
  const last = closeOf(series[series.length - 1], adjusted);
  const first = closeOf(series[0], adjusted);
  const sinceListing =
    last !== null && first !== null && first !== 0 ? last / first - 1 : null;
  const year = Number(lastDate.slice(0, 4));
  const prevYear = String(year - 1);
  const prevYearBars = series.filter((b) => b.date.startsWith(prevYear));
  if (!prevYearBars.length) {
    return { ytd: null, sinceListing, label: "上市以来" };
  }
  const base = closeOf(prevYearBars[prevYearBars.length - 1], adjusted);
  if (last === null || base === null || base === 0) {
    return { ytd: null, sinceListing, label: "上市以来" };
  }
  return { ytd: last / base - 1, sinceListing, label: "YTD" };
}

export function volumeRatio(bars: DailyBar[], lastDate: string): number | null {
  const series = sessionBars(bars, lastDate).filter((b) => b.volume !== null);
  if (series.length < 21) return null;
  const last = series[series.length - 1].volume;
  const prior = series.slice(-21, -1);
  const avg = prior.reduce((s, b) => s + (b.volume ?? 0), 0) / prior.length;
  if (!last || !avg) return null;
  return last / avg;
}

export function distTo52WHigh(
  bars: DailyBar[],
  lastDate: string,
  adjusted: boolean,
): number | null {
  const series = sessionBars(bars, lastDate);
  if (!series.length) return null;
  const window = series.slice(-252);
  const last = closeOf(window[window.length - 1], adjusted);
  let peak = -Infinity;
  for (const bar of window) {
    const c = closeOf(bar, adjusted);
    if (c !== null && c > peak) peak = c;
  }
  if (last === null || !Number.isFinite(peak) || peak === 0) return null;
  return last / peak - 1;
}

export function splitInWindow(splits: { date: string }[], lastDate: string, lookback: number): boolean {
  if (!splits.length) return false;
  const from = lastDate;
  return splits.some((s) => s.date <= from && s.date >= offsetDate(lastDate, -lookback));
}

function offsetDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function identityCheck(item: UniverseItem, quote?: QuoteSnapshot): {
  ok: boolean;
  note?: string;
} {
  if (!quote || quote.quoteType === "NONE") {
    return { ok: false, note: "无法核验上市状态或代码失效" };
  }
  const hay = `${quote.shortName ?? ""} ${quote.longName ?? ""}`;
  if (item.id === "SPCX") {
    const bad = /ETF|Trust|Direxion|ProShares|GraniteShares|SPAC ETF/i.test(hay);
    const good = /SpaceX|Space Exploration/i.test(hay);
    if (bad || !good) {
      return {
        ok: false,
        note: `名称「${hay.trim() || "未知"}」与 SpaceX 普通股设定不符，需复核映射`,
      };
    }
    return { ok: true };
  }
  if (item.id === "CBRS" && !/Cerebras|赛瑞巴斯/i.test(hay)) {
    return { ok: false, note: `名称「${hay.trim() || "未知"}」与 Cerebras Systems 不符` };
  }
  if (item.id === "SNK" && !/GraniteShares|做空SpaceX|Short SpaceX/i.test(hay)) {
    return { ok: false, note: `名称「${hay.trim() || "未知"}」与 2x Short SpaceX ETF 不符` };
  }
  if (item.id === "GLL" && !/UltraShort|做空黄金|Gold/i.test(hay)) {
    return { ok: false, note: `名称「${hay.trim() || "未知"}」与 UltraShort Gold 不符` };
  }
  if (item.identity.length && item.identity.some((k) => hay.toLowerCase().includes(k.toLowerCase()))) {
    return { ok: true };
  }
  if (quote.yahoo === item.yahoo || quote.symbol === item.yahoo) {
    return { ok: true };
  }
  return {
    ok: false,
    note: `名称「${hay.trim() || "未知"}」未匹配预期关键词`,
  };
}

export function isHalted(quote?: QuoteSnapshot): boolean {
  if (!quote) return false;
  const name = `${quote.shortName ?? ""} ${quote.longName ?? ""}`;
  return /halt|suspend|停牌/i.test(name) || quote.quoteType === "NONE";
}

function defaultThesis(): ThesisRecord {
  return { thesis: "", status: "？未建立", review: "正常跟踪" };
}

export function tagRow(input: {
  review: ReviewLevel;
  thesisStatus: ThesisStatus;
  ret1D: number | null;
  excess10D: number | null;
  volumeRatio: number | null;
  halted: boolean;
  listed: boolean;
  identityOk: boolean;
  material: boolean;
  inverse?: boolean;
}): RowTag {
  const xs = input.inverse ? null : input.excess10D;
  if (
    input.review === "重新评估" ||
    input.thesisStatus === "↓削弱" ||
    input.halted ||
    !input.listed ||
    !input.identityOk
  ) {
    return "需重新评估";
  }
  const hot =
    input.review === "重点关注" ||
    input.material ||
    (input.ret1D !== null && Math.abs(input.ret1D) >= 0.03) ||
    (xs !== null && Math.abs(xs) >= 0.05) ||
    (input.volumeRatio !== null && (input.volumeRatio >= 1.5 || input.volumeRatio < 0.6));
  if (hot) return "重点关注";
  if (xs !== null && xs >= 0.05 && (input.ret1D ?? 0) > 0) return "明显走强";
  return "正常";
}

export function buildInverseStats(
  item: UniverseItem,
  lastDate: string,
  self: SeriesBundle,
  under?: SeriesBundle,
): InverseStats | undefined {
  if (!item.inverse || !item.underlying) return undefined;
  const actual1D = periodReturn(self.bars, lastDate, 1, false);
  const underlying1D = under ? periodReturn(under.bars, lastDate, 1, false) : null;
  const target1D = underlying1D === null ? null : -2 * underlying1D;
  const deviation1D =
    actual1D === null || target1D === null ? null : actual1D - target1D;
  const underName = under?.quote?.shortName || item.underlying;
  return {
    kind: item.inverse,
    underlying: item.underlying,
    underlyingName: underName,
    target1D,
    actual1D,
    deviation1D,
    underlying1D,
    note: "多日累计不是标的累计收益的简单 -2 倍；关注当日目标偏差、路径依赖与波动损耗。",
  };
}

export function buildRow(
  item: UniverseItem,
  lastDate: string | null,
  bundle: SeriesBundle,
  bench?: SeriesBundle,
  under?: SeriesBundle,
  thesisMap: Record<string, ThesisRecord> = {},
  materialReasons: string[] = [],
): SecurityRow {
  const thesis = thesisMap[item.id] ?? defaultThesis();
  const listed = Boolean(bundle.quote && bundle.quote.quoteType !== "NONE" && bundle.bars.length);
  const identity = identityCheck(item, bundle.quote);
  const halted = isHalted(bundle.quote);
  const usedAdjusted = lastDate
    ? splitInWindow(bundle.splits, lastDate, 400)
    : false;
  const splitNote = bundle.splits.length
    ? bundle.splits
        .slice(-3)
        .map((s) => `${s.date} 拆股 ${s.ratio}`)
        .join("；")
    : undefined;

  const close = lastDate
    ? closeOf(
        sessionBars(bundle.bars, lastDate).at(-1) ?? { date: "", close: null, adjClose: null, open: null, high: null, low: null, volume: null },
        usedAdjusted,
      )
    : null;

  const ret1D = lastDate ? periodReturn(bundle.bars, lastDate, 1, usedAdjusted) : null;
  const ret5D = lastDate ? periodReturn(bundle.bars, lastDate, 5, usedAdjusted) : null;
  const ret10D = lastDate ? periodReturn(bundle.bars, lastDate, 10, usedAdjusted) : null;
  const ret20D = lastDate ? periodReturn(bundle.bars, lastDate, 20, usedAdjusted) : null;
  const ytd = lastDate ? ytdReturn(bundle.bars, lastDate, usedAdjusted) : { ytd: null, sinceListing: null, label: "YTD" as const };
  const vol = lastDate && !splitInWindow(bundle.splits, lastDate, 40)
    ? volumeRatio(bundle.bars, lastDate)
    : lastDate && splitInWindow(bundle.splits, lastDate, 40)
      ? null
      : lastDate
        ? volumeRatio(bundle.bars, lastDate)
        : null;
  const dist52W = lastDate ? distTo52WHigh(bundle.bars, lastDate, usedAdjusted) : null;

  const bench10 = lastDate && bench ? periodReturn(bench.bars, lastDate, 10, splitInWindow(bench.splits, lastDate, 400)) : null;
  const excess10D =
    item.inverse || ret10D === null || bench10 === null ? null : ret10D - bench10;

  const inverse = lastDate ? buildInverseStats(item, lastDate, bundle, under) : undefined;

  const moverReasons = [...materialReasons];
  if (ret1D !== null && Math.abs(ret1D) >= 0.03) moverReasons.push(`|1D| ${Math.abs(ret1D * 100).toFixed(2)}%`);
  if (!item.inverse && excess10D !== null && Math.abs(excess10D) >= 0.05) {
    moverReasons.push(`|10D超额| ${(Math.abs(excess10D) * 100).toFixed(2)}%`);
  }
  if (vol !== null && (vol >= 1.5 || vol < 0.6)) moverReasons.push(`量比 ${vol.toFixed(2)}`);
  if (halted) moverReasons.push("停牌或交易状态异常");
  if (!identity.ok) moverReasons.push("代码/名称核验异常");
  if (thesis.status !== "→未变" && thesis.status !== "？未建立") {
    moverReasons.push(`Thesis ${thesis.status}`);
  }

  const review: ReviewLevel =
    !listed || halted || !identity.ok
      ? "重新评估"
      : thesis.review;

  const tag = tagRow({
    review,
    thesisStatus: thesis.status,
    ret1D,
    excess10D,
    volumeRatio: vol,
    halted,
    listed,
    identityOk: identity.ok,
    material: materialReasons.length > 0,
    inverse: Boolean(item.inverse),
  });

  const notes = [...item.notes];
  if (usedAdjusted) notes.push("观察窗口内发生拆股，收益改用可比复权口径。");
  if (item.limitedExcess) notes.push("SPAC，普通指数超额解释力有限。");
  if (bundle.error) notes.push(`行情缺失：${bundle.error}`);

  return {
    id: item.id,
    display: item.display,
    name: bundle.quote?.shortName || item.name,
    yahoo: item.yahoo,
    market: item.market,
    group: item.group,
    currency: bundle.quote?.currency,
    close,
    ret1D,
    ret5D,
    ret10D,
    ret20D,
    retYtd: ytd.ytd,
    sinceListing: ytd.sinceListing,
    ytdLabel: ytd.label,
    excess10D,
    volumeRatio: vol,
    volumeClass: classifyVolume(vol),
    dist52W,
    thesisStatus: thesis.status,
    thesis: thesis.thesis,
    review,
    tag,
    sessionDate: lastDate,
    listed,
    halted,
    identityOk: identity.ok,
    identityNote: identity.note,
    splitNote,
    usedAdjusted,
    notes,
    inverse,
    limitedExcess: item.limitedExcess,
    moverReasons,
    sources: sourceLinks(item),
  };
}

export const TAG_ORDER: Record<RowTag, number> = {
  需重新评估: 0,
  重点关注: 1,
  明显走强: 2,
  正常: 3,
};

export function sortRows(rows: SecurityRow[]): SecurityRow[] {
  return [...rows].sort((a, b) => {
    const tr = TAG_ORDER[a.tag] - TAG_ORDER[b.tag];
    if (tr !== 0) return tr;
    const a1 = Math.abs(a.ret1D ?? 0);
    const b1 = Math.abs(b.ret1D ?? 0);
    if (a1 !== b1) return b1 - a1;
    return Math.abs(b.excess10D ?? 0) - Math.abs(a.excess10D ?? 0);
  });
}
