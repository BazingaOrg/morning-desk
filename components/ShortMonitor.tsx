"use client";

import type { Action, ShortMonitorReport } from "@/lib/short-monitor/types";
import { focusDecisionAsset } from "@/lib/short-monitor/presentation";
import { deskHeaders } from "@/lib/desk-token";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DeskMark } from "./DeskMark";

function actionCopy(action: Action, candidate?: boolean): string {
  if (action === "ENTER" || candidate) {
    return "ENTER · 下一常规交易时段候选，不是立刻成交";
  }
  if (action === "WAIT") return "WAIT，不提前猜顶";
  return action;
}

export function ShortMonitor({
  report,
  morningStatus,
  shortStatus,
  lastPublishedAt,
}: {
  report: ShortMonitorReport | null;
  morningStatus: string | null;
  shortStatus: string | null;
  lastPublishedAt: string | null;
}) {
  const [liveStatus, setLiveStatus] = useState(shortStatus);
  const [starting, setStarting] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);

  useEffect(() => {
    if (liveStatus !== "running") return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/short-monitor", { cache: "no-store" });
        const body = await response.json() as { status?: string | null };
        if (stopped) return;
        const next = body.status ?? null;
        setLiveStatus(next);
        if (next && next !== "running") window.location.reload();
      } catch {}
    };
    void poll();
    const timer = window.setInterval(poll, 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [liveStatus]);

  const startManualRun = async () => {
    setStarting(true);
    setManualMessage(null);
    try {
      const response = await fetch("/api/short-monitor/generate", {
        method: "POST",
        headers: deskHeaders(),
      });
      const body = await response.json() as { started?: boolean; status?: string; error?: string };
      if (response.status === 401) {
        setManualMessage("请先在晨报名单面板设置写入口令。");
      } else if (body.started) {
        setLiveStatus("running");
        setManualMessage("已开始运行，完成后页面会自动刷新。");
      } else if (body.status === "complete") {
        window.location.reload();
      } else {
        setManualMessage(`未启动：${body.status ?? body.error ?? "unknown"}`);
      }
    } catch {
      setManualMessage("手动运行请求失败。");
    } finally {
      setStarting(false);
    }
  };

  const focus = report
    ? focusDecisionAsset(report)
    : undefined;
  return (
    <div className="app">
      <header className="volnav">
        <nav className="vol-links" aria-label="分卷">
          <Link href="/">晨报</Link>
          <Link href="/short-monitor" aria-current="true">空头</Link>
        </nav>
        <div className="vol-actions">
          <button
            className="ghost"
            type="button"
            disabled={starting || liveStatus === "running"}
            onClick={startManualRun}
          >
            {starting || liveStatus === "running" ? "运行中" : "手动运行"}
          </button>
        </div>
      </header>
      <main className="desk">
        <article>
          <header className="issuebar">
            <div className="issue-meta">
              <span className="issue-vol">SHORT MONITOR</span>
              <div className="issue-date">隔夜快照 · 非盘中 desk</div>
            </div>
            <div className="wordmark">
              <DeskMark className="wordmark-mark" />
              <span>空头值守</span>
            </div>
            <div className="issue-side">
              AM
              <div>研究监控 · 非买卖建议</div>
            </div>
          </header>
          <p className="issue-sub">The Morning Desk · Overnight short monitor</p>

          <p className="footnote stale-note">
            自动任务 晨报 {morningStatus ?? "无"}　·　空头 {liveStatus ?? "无"}
            　·　未连接长桥，未核验账户可交易性
          </p>
          {manualMessage ? <p className="status" role="status">{manualMessage}</p> : null}

          {!report ? (
            <div className="splash">
              <p className="eyebrow">
                {liveStatus === "failed"
                  ? "今日空头流水线失败"
                  : liveStatus === "running"
                    ? "今日空头流水线运行中"
                    : "今日尚无空头报告"}
              </p>
              <h1>{liveStatus === "failed" ? "不展示历史 Action" : "等待 09:00 流水线"}</h1>
              <p className="lede">
                晨报发布后才会生成这份隔夜快照。DeepSeek 或证据源失败时这里会降级，不会回滚晨报。
              </p>
              {lastPublishedAt ? (
                <p className="footnote">上次发布 {lastPublishedAt}，仅作历史记录，未作为今日结论。</p>
              ) : null}
            </div>
          ) : (
            <>
              {report.status !== "ok" ? (
                <p className="status">
                  {report.status === "degraded" ? "降级" : "失败"}
                  {report.degradationReason ? `　·　${report.degradationReason}` : ""}
                </p>
              ) : null}

              <div className="tape">
                <p className="tape-kicker">隔夜快照 · 持仓 {report.position}</p>
                <div className="tape-digest short-monitor-digest">
                  <p>
                    {actionCopy(report.decision.action)}
                    <span className="tape-dot"> · </span>
                    最优 {report.decision.bestOpportunity}
                  </p>
                  <p>
                    快照 {report.marketSnapshotId}
                    <span className="tape-dot"> · </span>
                    {report.generatedAt}
                  </p>
                </div>
                <div className="tape-grid short-decision-grid">
                  <div className="kpi"><small>方向</small><b>{focus?.asset ?? "None"}</b></div>
                  <div className="kpi"><small>工具</small><b>{focus?.executionTool ?? "None"}</b></div>
                  <div className="kpi"><small>Trigger</small><b>{focus?.trigger ?? "N/A"}</b></div>
                  <div className="kpi"><small>Stop</small><b>{focus?.stop ?? "N/A"}</b></div>
                  <div className="kpi"><small>Exit</small><b>{focus?.exit ?? "N/A"}</b></div>
                  <div className="kpi"><small>R/R</small><b>{focus?.rr == null ? "N/A" : focus.rr.toFixed(2)}</b></div>
                  <div className="kpi">
                    <small>数据</small>
                    <b>{report.evidence.length} 条 / {report.gaps.length} 缺口</b>
                  </div>
                </div>
                <p className="footnote">
                  截止：美股 {report.dataCutoff.usSession ?? "N/A"} · {report.dataCutoff.usFreshness} ·
                  快照生成 {report.dataCutoff.snapshotGeneratedAt}
                  <span className="tape-dot"> · </span>
                  证据采集 {report.dataCutoff.evidenceCollectedAt}
                </p>
              </div>

              <section className="section" id="states">
                <p className="eyebrow">—— 四方向</p>
                <h2>状态表</h2>
                <div className="table-wrap short-state-wrap">
                  <table className="tape-table no-thesis short-state-table">
                    <thead>
                      <tr>
                        <th>方向</th>
                        <th>状态</th>
                        <th>Action</th>
                        <th>分数</th>
                        <th>工具</th>
                        <th>Trigger</th>
                        <th>Stop</th>
                        <th>Exit</th>
                        <th>R/R</th>
                        <th>原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.decision.assets.map((row) => (
                        <tr key={row.asset}>
                          <td className="mono">{row.asset}</td>
                          <td>{row.state}</td>
                          <td>
                            {row.action}
                            {row.action === "ENTER" ? (
                              <div className="name">下一时段候选</div>
                            ) : null}
                          </td>
                          <td className="mono">{row.score == null ? "N/A" : row.score}</td>
                          <td className="mono">{row.executionTool ?? "None"}</td>
                          <td>{row.trigger ?? "N/A"}</td>
                          <td className="mono">{row.stop ?? "N/A"}</td>
                          <td className="mono">{row.exit ?? "N/A"}</td>
                          <td className="mono">{row.rr == null ? "N/A" : row.rr.toFixed(2)}</td>
                          <td>{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="short-state-cards">
                  {report.decision.assets.map((row) => (
                    <article className="short-state-card" key={`card-${row.asset}`}>
                      <div><strong className="mono">{row.asset}</strong><span>{row.state} · {row.action}</span></div>
                      <dl>
                        <div><dt>分数</dt><dd>{row.score ?? "N/A"}</dd></div>
                        <div><dt>工具</dt><dd>{row.executionTool ?? "None"}</dd></div>
                        <div><dt>R/R</dt><dd>{row.rr == null ? "N/A" : row.rr.toFixed(2)}</dd></div>
                        <div><dt>Stop</dt><dd>{row.stop ?? "N/A"}</dd></div>
                      </dl>
                      <p>{row.trigger ?? row.reason}</p>
                    </article>
                  ))}
                </div>
                {report.position === "FLAT" ? (
                  <p className="footnote">FLAT：不展示 HOLD / REDUCE / EXIT。</p>
                ) : null}
              </section>

              <section className="section" id="changes">
                <p className="eyebrow">—— 跨日状态</p>
                <h2>相对上次报告</h2>
                <div className="table-wrap">
                  <table className="tape-table no-thesis">
                    <thead><tr><th>方向</th><th>上次</th><th>当前</th><th>分数变化</th></tr></thead>
                    <tbody>
                      {report.historyChanges.map((change) => (
                        <tr key={change.asset}>
                          <td className="mono">{change.asset}</td>
                          <td>{change.previousState ?? "首次"}</td>
                          <td>{change.currentState}</td>
                          <td className="mono">
                            {change.scoreDelta == null ? "N/A" : `${change.scoreDelta >= 0 ? "+" : ""}${change.scoreDelta}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="short-history-cards">
                  {report.historyChanges.map((change) => (
                    <p key={`history-${change.asset}`}>
                      <span className="mono">{change.asset}</span>　{change.previousState ?? "首次"} → {change.currentState}　
                      {change.scoreDelta == null ? "N/A" : `${change.scoreDelta >= 0 ? "+" : ""}${change.scoreDelta}`}
                    </p>
                  ))}
                </div>
              </section>

              <section className="section" id="catalysts">
                <p className="eyebrow">—— Catalyst Map</p>
                <h2>未来 7 天</h2>
                {report.catalysts7d.length ? report.catalysts7d.map((item) => (
                  <div className="review-item" key={item.id}>
                    <div><div className="mono">{item.date}</div><div className="muted">{item.kind}</div></div>
                    <div><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title}</a><div className="muted">{item.relevantAssets.join(" · ")}</div></div>
                  </div>
                )) : <p className="muted">未来 7 天没有已核验节点。</p>}
                {report.catalysts30d.length ? (
                  <details>
                    <summary>本周首个交易日 · 展开未来 30 天</summary>
                    {report.catalysts30d.map((item) => (
                      <p key={`30-${item.id}`}><span className="mono">{item.date}</span>　{item.title}</p>
                    ))}
                  </details>
                ) : null}
              </section>

              {report.modelOutput ? (
                <section className="section" id="narrative">
                  <p className="eyebrow">—— 叙事</p>
                  <h2>模型档位（不计分）</h2>
                  {(["SPCX", "SNDK", "NASDAQ", "GOLD"] as const).map((id) => {
                    const a = report.modelOutput?.assets[id];
                    if (!a) return null;
                    return (
                      <div key={id} className="review-item">
                        <div>
                          <div className="mono">{id}</div>
                          <div className="muted">
                            本质 {a.fundamentalShift}　预期差 {a.expectationGap}　催化 {a.catalystStrength}
                          </div>
                        </div>
                        <div>
                          <div>{a.consensus}</div>
                          <div className="muted">{a.variant}</div>
                          <div className="muted">Bear：{a.bearCase || "N/A"}</div>
                          <div className="muted">Bull：{a.bullCase || "N/A"}</div>
                          <div className="muted">证伪：{a.falsification || "N/A"}</div>
                        </div>
                      </div>
                    );
                  })}
                </section>
              ) : null}

              <section className="section" id="evidence">
                <p className="eyebrow">—— 审计</p>
                <h2>证据与缺口</h2>
                {report.gaps.length ? (
                  <div className="status">
                    {report.gaps.map((gap) => (
                      <p key={`${gap.source}-${gap.capability}-${gap.message}`}>
                        {gap.blocking ? "阻断" : "降级"} · {gap.source} · {gap.message}
                      </p>
                    ))}
                  </div>
                ) : <p className="muted">没有阻断缺口。</p>}
                {report.evidence.map((item) => (
                  <details key={item.id}>
                    <summary>{item.asset} · {item.title} · {item.signal}</summary>
                    <p>{item.summary}</p>
                    <p className="footnote">
                      {item.sourceName} · 观察 {item.observedAt} · 发布 {item.publishedAt ?? "N/A"} ·
                      期间 {item.period ?? "N/A"} · {item.verified && !item.stale ? "已核验" : "不可用于决策"}
                    </p>
                    <p><a href={item.sourceUrl} target="_blank" rel="noreferrer">原始来源</a></p>
                    {item.limitations.length ? <p className="muted">限制：{item.limitations.join("；")}</p> : null}
                  </details>
                ))}
              </section>

              <footer className="colophon">
                <p>
                  分数、状态和 Action 由代码计算。模型不得改写数值。V1 未接入 borrow / options / consensus，相关字段为 N/A。
                </p>
              </footer>
            </>
          )}
        </article>
      </main>
    </div>
  );
}
