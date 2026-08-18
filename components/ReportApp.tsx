"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { DailyReport } from "@/lib/types";
import { Briefing } from "./Briefing";

const themeListeners = new Set<() => void>();

function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ReportApp({
  initialReport,
}: {
  initialReport: DailyReport | null;
}) {
  const [report] = useState(initialReport);
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
  }, [report]);

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
        {report ? (
          <Briefing report={report} />
        ) : (
          <div className="splash">
            <p className="eyebrow">尚无报告</p>
            <h1>晨间值守</h1>
            <p className="lede">在服务器上运行 npm run generate，或等待工作日 09:00 定时任务。</p>
          </div>
        )}
      </main>
    </div>
  );
}
