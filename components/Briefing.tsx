"use client";

import { useMemo, useState } from "react";
import { DeskMark } from "@/components/DeskMark";
import { pct, price, ratio, signedClass } from "@/lib/format";
import type { DailyReport, RowTag, SecurityRow } from "@/lib/types";

function issueNo(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const doy = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  return String(doy).padStart(3, "0");
}

function weekday(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(y, m - 1, d));
}

function formatBeijingLongFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

function formatBeijingShortFromYmd(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}月${d}日`;
}

function tagShort(tag: RowTag): string | null {
  if (tag === "数据异常") return "异常";
  if (tag === "重点关注") return "关注";
  if (tag === "明显走强") return "走强";
  return null;
}

type NumericSortKey = "ret1D" | "ret10D" | "excess10D" | "volumeRatio";
type SortDirection = "asc" | "desc";
type SortState = {
  key: "default" | NumericSortKey;
  direction: SortDirection;
};

const DEFAULT_SORT: SortState = { key: "default", direction: "desc" };

function sortRowsForView(rows: SecurityRow[], sort: SortState): SecurityRow[] {
  if (sort.key === "default") return rows;
  const key = sort.key;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return a.display.localeCompare(b.display, "en");
    if (av === null) return 1;
    if (bv === null) return -1;
    const difference = sort.direction === "desc" ? bv - av : av - bv;
    return difference || a.display.localeCompare(b.display, "en");
  });
}

function SortableHeader({
  label,
  sortKey,
  sort,
  className,
  onChange,
}: {
  label: string;
  sortKey: NumericSortKey;
  sort: SortState;
  className?: string;
  onChange: (key: NumericSortKey) => void;
}) {
  const active = sort.key === sortKey;
  const direction = active ? sort.direction : null;
  return (
    <th
      className={className}
      aria-sort={direction === "desc" ? "descending" : direction === "asc" ? "ascending" : "none"}
    >
      <button className="sort-heading" type="button" onClick={() => onChange(sortKey)}>
        {label}<span aria-hidden="true">{direction === "desc" ? "↓" : direction === "asc" ? "↑" : "↕"}</span>
      </button>
    </th>
  );
}

function kpis(report: DailyReport) {
  const live = [...report.usRows, ...report.hkRows].filter((r) =>
    r.market === "US" ? report.us.isNew : report.hk.isNew,
  );
  const up = live.filter((r) => (r.ret1D ?? 0) > 0).length;
  const down = live.filter((r) => (r.ret1D ?? 0) < 0).length;
  const groups = new Map<string, number[]>();
  for (const row of live) {
    if (row.excess10D === null) continue;
    const arr = groups.get(row.group) ?? [];
    arr.push(row.excess10D);
    groups.set(row.group, arr);
  }
  const ranked = [...groups.entries()]
    .map(([name, xs]) => ({ name, xs: xs.reduce((a, b) => a + b, 0) / xs.length }))
    .sort((a, b) => b.xs - a.xs);
  const volume = live.filter((r) => r.volumeClass === "明显放量" || r.volumeClass === "明显缩量").length;
  const filings = report.movers.filter((m) => m.reasonHref).length;
  return {
    breadth: live.length ? `${up}/${live.length}` : "—",
    breadthNote: `收跌 ${down}　·　${report.chops.find((c) => c.key === "risk")?.value ?? ""}`,
    strong: ranked[0]?.name ?? "—",
    weak: ranked.at(-1)?.name ?? "—",
    volume: String(volume),
    filings: String(filings),
  };
}

function BookList({ rows }: { rows: SecurityRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="book">
      <li className="book-head">
        <span>代码</span>
        <span>1D</span>
      </li>
      {rows.map((row) => {
        const open = openId === row.id;
        const tag = tagShort(row.tag);
        const ytdValue = row.ytdLabel === "YTD" ? row.retYtd : row.sinceListing;
        return (
          <li key={row.id} className="book-item" data-tag={row.tag} data-open={open ? "true" : undefined}>
            <button
              type="button"
              className="book-row"
              aria-expanded={open}
              aria-label={`${row.display} ${row.name} 日收益 ${pct(row.ret1D)}`}
              onClick={() => setOpenId(open ? null : row.id)}
            >
              <span className="book-who">
                <span className="sym">{row.display}</span>
                <span className="name">
                  {row.name}
                  {row.limitedExcess ? " · SPAC" : ""}
                </span>
              </span>
              <span className="book-end">
                {tag ? <span className="book-tag" title={row.tag}>{tag}</span> : null}
                {row.volumeClass === "明显放量" || row.volumeClass === "明显缩量" ? (
                  <span className="book-cue">{row.volumeClass === "明显放量" ? "放量" : "缩量"}</span>
                ) : null}
                <span className={`book-1d mono ${signedClass(row.ret1D)}`}>{pct(row.ret1D)}</span>
              </span>
            </button>
            {open ? (
              <dl className="book-more">
                <div>
                  <dt>收盘</dt>
                  <dd className="mono">{price(row.close)}</dd>
                </div>
                <div>
                  <dt>10D</dt>
                  <dd className={`mono ${signedClass(row.ret10D)}`}>{pct(row.ret10D)}</dd>
                </div>
                <div>
                  <dt>超额</dt>
                  <dd className={`mono ${signedClass(row.excess10D)}`}>{pct(row.excess10D)}</dd>
                </div>
                <div>
                  <dt>量比</dt>
                  <dd className="mono">
                    {ratio(row.volumeRatio)}
                    {row.volumeClass ? <span className="name"> {row.volumeClass}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt>距高点</dt>
                  <dd className={`mono ${signedClass(row.dist52W)}`}>{pct(row.dist52W)}</dd>
                </div>
                <div>
                  <dt>{row.ytdLabel === "YTD" ? "YTD" : "上市以来"}</dt>
                  <dd className={`mono ${signedClass(ytdValue)}`}>{pct(ytdValue)}</dd>
                </div>
              </dl>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function UniverseTable({
  rows,
  caption,
  id,
  eyebrow,
}: {
  rows: SecurityRow[];
  caption: string;
  id: string;
  eyebrow: string;
}) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const sortedRows = useMemo(() => sortRowsForView(rows, sort), [rows, sort]);

  function changeSort(key: NumericSortKey) {
    setSort((current) => {
      if (current.key !== key) return { key, direction: "desc" };
      if (current.direction === "desc") return { key, direction: "asc" };
      return DEFAULT_SORT;
    });
  }

  function selectSort(value: string) {
    if (value === "default") {
      setSort(DEFAULT_SORT);
      return;
    }
    const [key, direction] = value.split(":") as [NumericSortKey, SortDirection];
    setSort({ key, direction });
  }

  const selectValue = sort.key === "default" ? "default" : `${sort.key}:${sort.direction}`;

  return (
    <section className="section" id={id}>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{caption}</h2>
      <div className="list-tools">
        <p className="legend">
          <span><i style={{ background: "var(--oxblood)" }} />数据异常</span>
          <span><i style={{ background: "var(--gold)" }} />重点关注</span>
          <span><i style={{ background: "var(--verdant)" }} />明显走强</span>
        </p>
        {sort.key !== "default" ? (
          <button className="sort-reset" type="button" onClick={() => setSort(DEFAULT_SORT)}>默认顺序</button>
        ) : null}
        <label className="mobile-sort">
          <span>排序</span>
          <select value={selectValue} onChange={(event) => selectSort(event.target.value)}>
            <option value="default">默认顺序</option>
            <option value="ret1D:desc">1D 高到低</option>
            <option value="ret1D:asc">1D 低到高</option>
            <option value="ret10D:desc">10D 高到低</option>
            <option value="ret10D:asc">10D 低到高</option>
            <option value="excess10D:desc">超额 高到低</option>
            <option value="excess10D:asc">超额 低到高</option>
            <option value="volumeRatio:desc">量比 高到低</option>
            <option value="volumeRatio:asc">量比 低到高</option>
          </select>
        </label>
      </div>
      <BookList rows={sortedRows} />
      <div className="table-wrap">
        <table className="tape-table">
          <colgroup>
            <col className="c-code" />
            <col className="c-name" />
            <col className="c-px" />
            <col className="c-ret" />
            <col className="c-ret" />
            <col className="c-ret" />
            <col className="c-vol col-secondary" />
            <col className="c-dist col-secondary" />
            <col className="c-ytd col-secondary" />
          </colgroup>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>收盘</th>
              <SortableHeader label="1D" sortKey="ret1D" sort={sort} onChange={changeSort} />
              <SortableHeader label="10D" sortKey="ret10D" sort={sort} onChange={changeSort} />
              <SortableHeader label="超额" sortKey="excess10D" sort={sort} onChange={changeSort} />
              <SortableHeader className="col-secondary" label="量比" sortKey="volumeRatio" sort={sort} onChange={changeSort} />
              <th className="col-secondary">距高点</th>
              <th className="col-secondary">YTD</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id} data-tag={row.tag}>
                <td>{row.display}</td>
                <td className="cell-name">
                  {row.name}
                  {row.limitedExcess ? <div className="name">SPAC</div> : null}
                </td>
                <td className="mono">{price(row.close)}</td>
                <td className={`mono ${signedClass(row.ret1D)}`}>{pct(row.ret1D)}</td>
                <td className={`mono ${signedClass(row.ret10D)}`}>{pct(row.ret10D)}</td>
                <td className={`mono ${signedClass(row.excess10D)}`}>{pct(row.excess10D)}</td>
                <td className="mono col-secondary">
                  {ratio(row.volumeRatio)}
                  <div className="name">{row.volumeClass ?? ""}</div>
                </td>
                <td className={`mono col-secondary ${signedClass(row.dist52W)}`}>{pct(row.dist52W)}</td>
                <td className={`mono col-secondary ${signedClass(row.ytdLabel === "YTD" ? row.retYtd : row.sinceListing)}`}>
                  {row.ytdLabel === "YTD" ? pct(row.retYtd) : pct(row.sinceListing)}
                  {row.ytdLabel !== "YTD" ? <div className="name">上市以来</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Briefing({
  report,
  staleStats = false,
}: {
  report: DailyReport;
  staleStats?: boolean;
}) {
  const stat = kpis(report);
  const showCatalysts = report.catalysts.length > 0;

  return (
    <article>
      <header className="issuebar">
        <div className="issue-meta">
          <span className="issue-vol">VOL. {report.beijingDate.slice(0, 4)} · NO. {issueNo(report.beijingDate)}</span>
          <div className="issue-date">{formatBeijingLongFromYmd(report.beijingDate)} · {weekday(report.beijingDate)}</div>
          <div className="issue-date-short">{formatBeijingShortFromYmd(report.beijingDate)} · {weekday(report.beijingDate)}</div>
        </div>
        <div className="wordmark">
          <DeskMark className="wordmark-mark" />
          <span>晨间值守</span>
        </div>
        <div className="issue-side">
          AM
          <div>完整收盘 · 非买卖建议</div>
        </div>
      </header>
      <p className="issue-sub">The Morning Desk · 判断市场是否正在重新定价</p>
      {staleStats ? (
        <p className="footnote stale-note">名单已改，判断与涨跌家数待下次生成。</p>
      ) : null}

      <div className="brief-lead">
        <div className="tape-block">
          <div className="tape">
            <p className="tape-kicker">今日 · 下面数字用的是已完成交易日收盘，不是盘中价</p>
            <div className="tape-digest">
              <p>
                美股 {report.us.sessionDate ?? "暂无"}
                <span className="tape-dot"> · </span>
                港股 {report.hk.sessionDate ?? "暂无"}
              </p>
              <p>
                {stat.breadth} 上涨
                <span className="tape-dot"> · </span>
                强 {stat.strong}
                <span className="tape-dot"> · </span>
                弱 {stat.weak}
                <span className="tape-dot"> · </span>
                量能 {stat.volume}
              </p>
            </div>
            <div className="session-pills">
              <div className="kpi">
                <small>美股收盘</small>
                <b>{report.us.sessionDate ?? "暂无"}</b>
                <span>{report.us.label}</span>
              </div>
              <div className="kpi">
                <small>港股收盘</small>
                <b>{report.hk.sessionDate ?? "暂无"}</b>
                <span>{report.hk.label}</span>
              </div>
              <div className="kpi">
                <small>本页生成</small>
                <b>{report.generatedAt.slice(5, 16)}</b>
                <span>北京时间</span>
              </div>
            </div>
            <div className="tape-grid">
              <div className="kpi">
                <small>涨跌家数</small>
                <b>{stat.breadth}</b>
                <span>{stat.breadthNote}</span>
              </div>
              <div className="kpi">
                <small>相对最强</small>
                <b>{stat.strong}</b>
                <span>按 10 日超额分组</span>
              </div>
              <div className="kpi">
                <small>相对最弱</small>
                <b>{stat.weak}</b>
                <span>不是买卖方向</span>
              </div>
              <div className="kpi">
                <small>量能极端</small>
                <b>{stat.volume}</b>
                <span>明显放量或缩量</span>
              </div>
              <div className="kpi">
                <small>对上公告</small>
                <b>{stat.filings}</b>
                <span>SEC / HKEX 原文</span>
              </div>
            </div>
          </div>
          {report.closedBoth ? <div className="closed-banner">{report.closedNote}</div> : null}
        </div>

        {!report.closedBoth ? (
          <div className="sheet-lead">
            <section className="section" id="lede">
              <p className="eyebrow">—— 卷一 · 今日判断</p>
              <h2>市场是否在重新定价</h2>
              {report.conclusion.map((line) => (
                <p key={line} className="lede">{line}</p>
              ))}
            </section>
          </div>
        ) : null}
      </div>

      <div className="sheet-body">
        {!report.closedBoth ? (
          <section className="section" id="movers">
            <p className="eyebrow">—— 卷二 · 重点异动</p>
            <h2>最多八条</h2>
            {report.movers.length === 0 ? (
              <p className="empty">今日无符合进入条件的新异动。</p>
            ) : (
              <div className="movers">
                <div className="mover-head">
                  <div>代码</div>
                  <div>1D</div>
                  <div>10D</div>
                  <div>超额</div>
                  <div>量比</div>
                  <div>为何入选</div>
                </div>
                {report.movers.map((m) => (
                  <div key={m.id} className="mover">
                    <div className="mover-who">
                      <span className="sym">{m.display}</span>
                      <span className="name">{m.name}</span>
                      {m.reasonHref ? (
                        <a className="reason" href={m.reasonHref} target="_blank" rel="noreferrer">
                          {m.reason}
                        </a>
                      ) : null}
                    </div>
                    <div className={`mover-ret1 mono ${signedClass(m.ret1D)}`} data-label="1D">{pct(m.ret1D)}</div>
                    <div className={`mover-ret10 mono ${signedClass(m.ret10D)}`} data-label="10D">{pct(m.ret10D)}</div>
                    <div className={`mover-xs mono ${signedClass(m.excess10D)}`} data-label="超额">{pct(m.excess10D)}</div>
                    <div className="mover-vol mono" data-label="量比">{ratio(m.volumeRatio)}</div>
                    <div className="mover-aux">
                      <span>10D {pct(m.ret10D)}</span>
                      <span>超额 {pct(m.excess10D)}</span>
                      <span>量比 {ratio(m.volumeRatio)}</span>
                    </div>
                    <div className="mover-why" data-label="为何">{m.nature}</div>
                  </div>
                ))}
              </div>
            )}
            <p className="footnote">
              「为何入选」是价格或量能规则。只有对上 SEC / HKEX 原文时，代码下方才出现可点击公告。
            </p>
          </section>
        ) : null}

        <UniverseTable
          rows={report.usRows}
          caption={`美股 · ${report.usRows.length} 只`}
          id="us"
          eyebrow="—— 卷三 · 美股"
        />
        <UniverseTable
          rows={report.hkRows}
          caption={`港股 · ${report.hkRows.length} 只`}
          id="hk"
          eyebrow="—— 卷四 · 港股"
        />

        {showCatalysts ? (
          <section className="section" id="catalysts">
            <p className="eyebrow">—— 卷五 · 已确认日程</p>
            <h2>未来 30 天</h2>
            {report.catalysts.map((c) => (
              <div key={`${c.id}-${c.date}`} className="catalyst-item">
                <div className="mono">
                  {c.display}
                  <div className="name">{c.name}</div>
                </div>
                <div>
                  {c.kind}　{c.date}
                  <div className="muted">
                    {c.href ? (
                      <a className="reason" href={c.href} target="_blank" rel="noreferrer">{c.detail}</a>
                    ) : c.detail}
                  </div>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <footer className="colophon" id="audit">
          <p>
            {report.generatedAt} 生成　·　价格来自新浪 / 腾讯完整收盘　·　公告来自
            <a href="https://www.sec.gov/search-filings"> SEC</a> /
            <a href="https://www.hkexnews.hk/"> HKEX</a>
          </p>
        </footer>
      </div>
    </article>
  );
}
