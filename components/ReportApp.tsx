"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { DailyReport } from "@/lib/types";
import { Briefing } from "./Briefing";
import { DeskMark } from "./DeskMark";

const themeListeners = new Set<() => void>();

function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ReportApp({
  initialReport,
  initialUpdating,
}: {
  initialReport: DailyReport | null;
  initialUpdating: boolean;
}) {
  const [report, setReport] = useState(initialReport);
  const [updating, setUpdating] = useState(initialUpdating);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState("lede");
  const theme = useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb);
      return () => {
        themeListeners.delete(cb);
      };
    },
    currentTheme,
    () => "light",
  );

  useEffect(() => {
    if (!updating) return;
    let stop = false;
    async function tick() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const json = (await res.json()) as { live?: boolean; state?: string };
        if (stop) return;
        if (json.live) return;
        if (json.state === "error") {
          setUpdating(false);
          setFailed(true);
          return;
        }
        const latest = await fetch("/api/report", { cache: "no-store" });
        const body = (await latest.json()) as { report: DailyReport | null };
        if (stop) return;
        if (body.report) setReport(body.report);
        setUpdating(false);
      } catch {
        if (!stop) setFailed(true);
      }
    }
    tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [updating]);

  useEffect(() => {
    if (updating) return;
    const ids = ["lede", "movers", "us", "hk", "thesis", "catalysts"];
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!nodes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit?.target.id) setActive(hit.target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0.1, 0.35, 0.6] },
    );
    for (const node of nodes) io.observe(node);
    return () => io.disconnect();
  }, [report, updating]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("desk-theme", next);
    } catch {}
    for (const cb of themeListeners) cb();
  }

  return (
    <div className="app">
      <header className="volnav">
        <nav className="vol-links" aria-label="分卷">
          <a href="#lede" aria-current={active === "lede" ? "true" : undefined}>判断</a>
          <a href="#movers" aria-current={active === "movers" ? "true" : undefined}>异动</a>
          <a href="#us" aria-current={active === "us" ? "true" : undefined}>美股</a>
          <a href="#hk" aria-current={active === "hk" ? "true" : undefined}>港股</a>
          {report?.thesisReviews.length ? (
            <a href="#thesis" aria-current={active === "thesis" ? "true" : undefined}>复核</a>
          ) : null}
          {report?.catalysts.length ? (
            <a href="#catalysts" aria-current={active === "catalysts" ? "true" : undefined}>日程</a>
          ) : null}
        </nav>
        <div className="vol-actions">
          <button
            className="ghost theme-toggle"
            onClick={toggleTheme}
            type="button"
            aria-pressed={theme === "dark"}
            aria-label={theme === "dark" ? "切换到晨间模式" : "切换到夜盘模式"}
          >
            {theme === "dark" ? "晨盘" : "夜盘"}
          </button>
        </div>
      </header>

      <main className="desk">
        {updating ? (
          <div className="splash updating" role="status" aria-live="polite">
            <DeskMark className="splash-mark" />
            <p className="eyebrow">晨报生成中</p>
            <h1>正在拉取完整收盘</h1>
            <p className="lede">美股、港股分别取最近一个已完成交易日。约 1–2 分钟，完成后会自动刷新。此刻不展示上一份表格，以免和未完成的数据混在一起。</p>
            <p className="pulse-line"><span className="pulse" aria-hidden="true" />准备日线与公告核对</p>
          </div>
        ) : report ? (
          <>
            {failed ? (
              <p className="status">这次更新没有完成，下面仍是上一份完整收盘。</p>
            ) : null}
            <Briefing report={report} />
          </>
        ) : (
          <div className="splash">
            <DeskMark className="splash-mark" />
            <p className="eyebrow">尚无报告</p>
            <h1>晨间值守</h1>
            <p className="lede">等待工作日 09:00 定时任务，或在服务器运行 npm run generate。</p>
          </div>
        )}
      </main>
    </div>
  );
}
