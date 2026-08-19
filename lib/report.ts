import { buildRow, sortRows } from "./calc";
import { beijingDate, formatBeijingStamp, HK_TZ, inNextDays, lastCompleteSessionDate, US_TZ } from "./time";
import type {
  Catalyst,
  Chop,
  DailyReport,
  MarketStamp,
  MoverLine,
  SecurityRow,
  SeriesBundle,
  ThesisReviewItem,
} from "./types";
import { collectFacts, factsFor, type FactDoc } from "./facts";
import { HK_REF, UNIVERSE, US_REF } from "./universe";
import { fetchUniverseSeries } from "./yahoo";
import { loadThesis, saveReport, saveState } from "./store";

function lastCompleteDate(bundle: SeriesBundle | undefined, exchangeTz: string): string | null {
  if (!bundle?.bars.length) return null;
  const tz = bundle.quote?.exchangeTimezoneName || exchangeTz;
  return lastCompleteSessionDate(
    bundle.bars.map((bar) => bar.date),
    tz,
  );
}

function stampFor(market: "US" | "HK", sessionDate: string | null): MarketStamp {
  if (!sessionDate) {
    return {
      market,
      sessionDate: null,
      isNew: false,
      closed: true,
      label: "休市／无新收盘数据",
    };
  }
  return {
    market,
    sessionDate,
    isNew: true,
    closed: false,
    label: `${sessionDate} 已收盘`,
  };
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function groupStrength(rows: SecurityRow[]): { name: string; xs: number }[] {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    if (row.excess10D === null || row.inverse) continue;
    const arr = map.get(row.group) ?? [];
    arr.push(row.excess10D);
    map.set(row.group, arr);
  }
  return [...map.entries()]
    .map(([name, xs]) => ({ name, xs: avg(xs) ?? 0 }))
    .sort((a, b) => b.xs - a.xs);
}

function buildConclusion(
  us: MarketStamp,
  hk: MarketStamp,
  usRows: SecurityRow[],
  hkRows: SecurityRow[],
  movers: MoverLine[],
  thesisReviews: ThesisReviewItem[],
): string[] {
  if (us.closed && hk.closed) {
    return [];
  }
  const lines: string[] = [];
  if (us.isNew) {
    const up = usRows.filter((r) => (r.ret1D ?? 0) > 0).length;
    const beat = usRows.filter((r) => (r.excess10D ?? 0) > 0 && !r.inverse).length;
    const groups = groupStrength(usRows);
    const strong = groups[0];
    const weak = groups[groups.length - 1];
    lines.push(
      `美股采用 ${us.sessionDate} 完整收盘：纳入统计的 ${usRows.length} 只中 ${up} 只收涨，10 日超额为正 ${beat} 只。` +
        (strong && weak && strong.name !== weak.name
          ? `${strong.name}相对最强，${weak.name}相对最弱。`
          : ""),
    );
  } else {
    lines.push("美股今日无新的完整收盘，不重复解读旧行情。");
  }
  if (hk.isNew) {
    const up = hkRows.filter((r) => (r.ret1D ?? 0) > 0).length;
    const groups = groupStrength(hkRows);
    const strong = groups[0];
    const weak = groups[groups.length - 1];
    lines.push(
      `港股采用 ${hk.sessionDate} 完整收盘：7 只中 ${up} 只收涨。` +
        (strong && weak && strong.name !== weak.name
          ? `${strong.name}相对更强，${weak.name}相对更弱。`
          : ""),
    );
  } else {
    lines.push("港股今日无新的完整收盘，不重复解读旧行情。");
  }

  const volumeHot = movers.filter((m) => m.nature.includes("放量") || m.nature.includes("缩量"));
  if (volumeHot.length) {
    lines.push(
      `量能极端 ${volumeHot.length} 只：${volumeHot
        .slice(0, 4)
        .map((m) => m.display)
        .join("、")}${volumeHot.length > 4 ? " 等" : ""}。`,
    );
  } else if (us.isNew || hk.isNew) {
    lines.push("未见明显放量或明显缩量的新异动。");
  }

  const thesisRisk = thesisReviews.filter((t) => t.review !== "正常跟踪" || t.status === "↓削弱");
  const unbuiltCount = [...usRows, ...hkRows].filter((r) => r.thesisStatus === "？未建立").length;
  if (thesisRisk.length) {
    lines.push(
      `持有逻辑需复核 ${thesisRisk.length} 只，级别含 ${[...new Set(thesisRisk.map((t) => t.review))].join("、")}。Thesis 不因单日涨跌自动改写。`,
    );
  } else {
    lines.push(
      unbuiltCount === 52
        ? "52 只证券的持有逻辑均未建立，本次不因价格波动补写或改写 Thesis。"
        : "未见已核验的 Thesis 状态变化；单日涨跌本身不构成持有逻辑变化。",
    );
  }
  return lines.slice(0, 5);
}

function natureOf(row: SecurityRow): string {
  const bits: string[] = [];
  if (row.tag === "需重新评估") bits.push("需重新评估");
  if (row.halted) bits.push("停牌");
  if (!row.identityOk) bits.push("代码核验");
  if (row.volumeClass === "明显放量" || row.volumeClass === "明显缩量") bits.push(row.volumeClass);
  if (row.ret1D !== null && Math.abs(row.ret1D) >= 0.03) bits.push("日涨跌");
  if (!row.inverse && row.excess10D !== null && Math.abs(row.excess10D) >= 0.05) bits.push("相对强弱");
  if (row.thesisStatus === "↑强化" || row.thesisStatus === "↓削弱") bits.push("Thesis");
  if (row.moverReasons.some((x) => /8-K|10-Q|10-K|6-K|HK|董事会|股东|业绩/.test(x))) bits.push("公告");
  if (row.inverse) bits.push("杠杆反向");
  return bits.slice(0, 3).join("／") || "异动";
}

function moverReason(
  row: SecurityRow,
  docs: FactDoc[],
): { reason: string; href?: string } {
  const hit = docs[0];
  if (hit) {
    const label = hit.title.startsWith(hit.kind) ? hit.title : `${hit.kind}｜${hit.title}`;
    return { reason: label.slice(0, 80), href: hit.href };
  }
  const verified = row.moverReasons.filter(
    (r) => r.includes("拆股") || r.includes("停牌") || r.includes("核验") || r.includes("除息"),
  );
  if (verified.length) return { reason: verified.join("；") };
  if (row.inverse && row.inverse.deviation1D !== null) {
    return {
      reason: `反向产品当日目标偏差 ${(row.inverse.deviation1D * 100).toFixed(2)} 个百分点；暂无可靠公开公司事件`,
    };
  }
  return { reason: "暂无可靠公开原因" };
}

function pickMovers(
  rows: SecurityRow[],
  allow: Set<"US" | "HK">,
  factMap: Map<string, FactDoc[]>,
): MoverLine[] {
  const scored = rows
    .filter((r) => allow.has(r.market))
    .filter((r) => {
      const by1 = r.ret1D !== null && Math.abs(r.ret1D) >= 0.03;
      const byXs = !r.inverse && r.excess10D !== null && Math.abs(r.excess10D) >= 0.05;
      const byVol = r.volumeRatio !== null && (r.volumeRatio >= 1.5 || r.volumeRatio < 0.6);
      const byEvent = r.halted || !r.identityOk || r.notes.some((n) => n.includes("拆股"));
      const byThesis = r.thesisStatus === "↑强化" || r.thesisStatus === "↓削弱";
      const byFact = (factMap.get(r.id) ?? []).length > 0;
      return by1 || byXs || byVol || byEvent || byThesis || byFact;
    })
    .map((r) => {
      const score =
        (r.tag === "需重新评估" ? 40 : 0) +
        (r.halted || !r.identityOk ? 30 : 0) +
        Math.abs(r.ret1D ?? 0) * 100 +
        Math.abs(r.inverse ? 0 : (r.excess10D ?? 0)) * 40 +
        (r.volumeRatio !== null && r.volumeRatio >= 1.5 ? 8 : 0) +
        (r.volumeRatio !== null && r.volumeRatio < 0.6 ? 6 : 0);
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ r }) => {
      const explained = moverReason(r, factMap.get(r.id) ?? []);
      return {
        id: r.id,
        display: r.display,
        name: r.name,
        ret1D: r.ret1D,
        ret10D: r.ret10D,
        excess10D: r.inverse ? null : r.excess10D,
        volumeRatio: r.volumeRatio,
        nature: natureOf(r),
        reason: explained.reason,
        reasonHref: explained.href,
        tag: r.tag,
      };
    });
  return scored;
}

function thesisReviews(rows: SecurityRow[]): ThesisReviewItem[] {
  return rows
    .filter(
      (r) =>
        r.review !== "正常跟踪" ||
        r.thesisStatus === "↑强化" ||
        r.thesisStatus === "↓削弱" ||
        !r.identityOk ||
        r.halted,
    )
    .map((r) => ({
      id: r.id,
      display: r.display,
      name: r.name,
      status: r.thesisStatus,
      review: r.review,
      thesis: r.thesis || "？未建立",
      why:
        r.identityNote ||
        (r.halted ? "交易状态异常" : "") ||
        (r.review === "重新评估" ? "需复核上市或持有前提" : "价格或量能触发关注，Thesis 本身未自动改写"),
    }));
}

function buildChops(
  us: MarketStamp,
  hk: MarketStamp,
  rows: SecurityRow[],
  reviews: ThesisReviewItem[],
): Chop[] {
  if (us.closed && hk.closed) {
    return [
      { key: "risk", title: "风险偏好", value: "休市", tone: "idle" },
      { key: "rs", title: "相对强弱", value: "无新数据", tone: "idle" },
      { key: "thesis", title: "Thesis", value: "不更新", tone: "idle" },
    ];
  }
  const live = rows.filter((r) => (r.market === "US" ? us.isNew : hk.isNew));
  const up = live.filter((r) => (r.ret1D ?? 0) > 0).length;
  const down = live.filter((r) => (r.ret1D ?? 0) < 0).length;
  const riskValue = up - down >= 8 ? "偏进攻" : down - up >= 8 ? "偏防御" : "中性分化";
  const riskTone = riskValue === "偏进攻" ? "strong" : riskValue === "偏防御" ? "alert" : "calm";

  const xs = live.filter((r) => r.excess10D !== null && !r.inverse);
  const beat = xs.filter((r) => (r.excess10D ?? 0) > 0).length;
  const rsValue =
    xs.length === 0 ? "样本不足" : beat / xs.length >= 0.6 ? "强于基准" : beat / xs.length <= 0.4 ? "弱于基准" : "内部分化";
  const rsTone = rsValue === "强于基准" ? "strong" : rsValue === "弱于基准" ? "alert" : "calm";

  const need = reviews.filter((r) => r.review === "重新评估").length;
  const watch = reviews.filter((r) => r.review === "重点关注").length;
  const unbuilt = rows.filter((r) => r.thesisStatus === "？未建立").length;
  const thesisValue = need ? "需重估" : watch ? "需关注" : unbuilt === 52 ? "未建立" : "无复核";
  const thesisTone = need ? "alert" : watch ? "calm" : "idle";

  return [
    { key: "risk", title: "风险偏好", value: riskValue, tone: riskTone },
    { key: "rs", title: "相对强弱", value: rsValue, tone: rsTone },
    { key: "thesis", title: "Thesis", value: thesisValue, tone: thesisTone },
  ];
}

function materialFor(
  lastDate: string | null,
  bundle: SeriesBundle,
  docs: FactDoc[],
): string[] {
  const reasons: string[] = [];
  if (!lastDate) return reasons;
  if (bundle.splits.some((s) => s.date === lastDate)) {
    const s = bundle.splits.find((x) => x.date === lastDate);
    reasons.push(`拆股 ${s?.ratio ?? ""}`.trim());
  }
  if (bundle.dividends.some((d) => d.date === lastDate)) {
    reasons.push("除息");
  }
  for (const doc of docs) {
    reasons.push(`${doc.kind} ${doc.title}`.trim());
  }
  return reasons;
}

function sessionWindow(bundle: SeriesBundle | undefined, lastDate: string | null, n = 2): string[] {
  if (!bundle || !lastDate) return [];
  const dates = bundle.bars.filter((b) => b.date <= lastDate && b.close !== null).map((b) => b.date);
  return dates.slice(-n);
}

export async function generateReport(): Promise<DailyReport> {
  const generatedAt = new Date();
  const bj = beijingDate(generatedAt);
  const thesis = await loadThesis();

  const series = await fetchUniverseSeries(new Map());

  const usRef = series.get(US_REF);
  const hkRef = series.get(HK_REF);
  const usSession = lastCompleteDate(usRef, US_TZ);
  const hkSession = lastCompleteDate(hkRef, HK_TZ);

  const us = stampFor("US", usSession);
  const hk = stampFor("HK", hkSession);

  const closedBoth = !us.isNew && !hk.isNew;
  const usWindow = sessionWindow(usRef, usSession, 2);
  const hkWindow = sessionWindow(hkRef, hkSession, 2);
  const facts = await collectFacts({
    items: UNIVERSE,
    usSessions: usWindow,
    hkSessions: hkWindow,
  });
  const factById = new Map<string, FactDoc[]>();
  for (const item of UNIVERSE) {
    const window = item.market === "US" ? usWindow : hkWindow;
    factById.set(item.id, factsFor(facts.docs, item.id, window));
  }

  const rows: SecurityRow[] = UNIVERSE.map((item) => {
    const session = item.market === "US" ? usSession : hkSession;
    const bundle = series.get(item.yahoo) ?? {
      item,
      bars: [],
      splits: [],
      dividends: [],
      error: "无行情",
    };
    const bench = item.benchmark ? series.get(item.benchmark) : undefined;
    const under = item.underlying ? series.get(item.underlying) : undefined;
    const material = materialFor(session, bundle, factById.get(item.id) ?? []);
    return buildRow(item, session, bundle, bench, under, thesis, material);
  });

  const usRows = sortRows(rows.filter((r) => r.market === "US"));
  const hkRows = sortRows(rows.filter((r) => r.market === "HK"));
  const allow = new Set<"US" | "HK">();
  if (us.isNew) allow.add("US");
  if (hk.isNew) allow.add("HK");
  const movers = closedBoth ? [] : pickMovers([...usRows, ...hkRows], allow, factById);
  const reviews = thesisReviews([...usRows, ...hkRows]);
  const chops = buildChops(us, hk, [...usRows, ...hkRows], reviews);
  const conclusion = buildConclusion(us, hk, usRows, hkRows, movers, reviews);

  const catalysts: Catalyst[] = [];
  for (const item of UNIVERSE) {
    for (const doc of facts.docs.filter((d) => d.id === item.id)) {
      if (!doc.catalystDate || !doc.official || !inNextDays(doc.catalystDate, bj, 30)) continue;
      catalysts.push({
        id: item.id,
        display: item.display,
        name: item.name,
        kind: doc.kind,
        date: doc.catalystDate,
        confirmed: true,
        detail: doc.title,
        href: doc.href,
      });
    }
  }

  const identityFlags = rows
    .filter((r) => !r.identityOk)
    .map((r) => `${r.display}：${r.identityNote ?? "名称核验失败"}`);

  const gaps: string[] = [];
  for (const row of rows) {
    if (row.close === null) gaps.push(`${row.display} 缺少收盘价`);
    if (row.retYtd === null && row.ytdLabel === "YTD") gaps.push(`${row.display} 缺少上年年末收盘，YTD 为 N/A`);
    if (row.volumeRatio === null) gaps.push(`${row.display} 量比 N/A`);
  }

  const unfinished = [
    "异动原因仅在对上 SEC 申报或 HKEX 公告标题时写入；否则为「暂无可靠公开原因」。",
    "未来 30 天只列能从官方公告标题解析出日期的节点。",
    "Thesis 仅读取 data/thesis.json，价格波动不会改写状态。",
  ];

  const holidays: string[] = [];
  if (us.closed) holidays.push("美股无新完整交易日");
  if (hk.closed) holidays.push("港股无新完整交易日");

  const report: DailyReport = {
    title: "晨间值守",
    beijingDate: bj,
    generatedAt: formatBeijingStamp(generatedAt),
    timezone: "Asia/Shanghai",
    closedBoth,
    closedNote: closedBoth
      ? `美股、港股均无新的完整收盘（美股 ${us.sessionDate ?? "暂无新数据"}，港股 ${hk.sessionDate ?? "暂无新数据"}）。不重复解读旧行情。`
      : undefined,
    us,
    hk,
    chops,
    conclusion,
    movers,
    usRows,
    hkRows,
    thesisReviews: reviews,
    catalysts,
    audit: {
      generatedAt: formatBeijingStamp(generatedAt),
      sources: [
        "美股日线：新浪 US_MinKService（完整已收盘日；代码复用时只保留最近连续段）",
        "港股日线：腾讯行情 fqkline（完整已收盘日）",
        "名称与市场状态：腾讯行情快照",
        ...facts.sourcesUsed,
        "持有逻辑：data/thesis.json",
      ],
      gaps: [...facts.gaps, ...gaps].slice(0, 40),
      holidays,
      identityFlags,
      unfinished,
    },
  };

  await saveReport(report);
  await saveState({
    lastBeijingDate: bj,
    lastUsSession: usSession,
    lastHkSession: hkSession,
  });
  return report;
}
