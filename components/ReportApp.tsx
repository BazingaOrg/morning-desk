"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { DailyReport, UniversePayload } from "@/lib/types";
import { presentReport } from "@/lib/universe-query";
import { Briefing } from "./Briefing";
import { DeskMark } from "./DeskMark";
import { UniversePanel } from "./UniversePanel";

const themeListeners = new Set<() => void>();

function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ReportApp({
  initialReport,
  initialUpdating,
  initialUniverse,
}: {
  initialReport: DailyReport | null;
  initialUpdating: boolean;
  initialUniverse: UniversePayload;
}) {
  const [report, setReport] = useState(initialReport);
  const [universe, setUniverse] = useState(initialUniverse);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [updating, setUpdating] = useState(initialUpdating);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState("lede");
  const rosterBtnRef = useRef<HTMLButtonElement>(null);
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
        try {
          const uniRes = await fetch("/api/universe", { cache: "no-store" });
          if (uniRes.ok) {
            const uni = (await uniRes.json()) as UniversePayload;
            if (!stop) setUniverse(uni);
          }
        } catch {}
        if (!stop) setUpdating(false);
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
    const ids = ["lede", "movers", "us", "hk", "catalysts"];
    function update() {
      const line = window.innerHeight * 0.28;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [report, updating]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("desk-theme", next);
    } catch {}
    for (const cb of themeListeners) cb();
  }

  const closeRoster = useCallback(() => {
    setRosterOpen(false);
    requestAnimationFrame(() => rosterBtnRef.current?.focus());
  }, []);

  async function openRoster() {
    setRosterOpen(true);
    try {
      const res = await fetch("/api/universe", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as UniversePayload;
      setUniverse(body);
    } catch {}
  }

  function onChanged(next: UniversePayload, extra?: { started?: boolean }) {
    setUniverse(next);
    setReport((prev) =>
      prev ? presentReport(prev, next.items) : prev,
    );
    if (extra?.started) {
      setUpdating(true);
      setFailed(false);
      closeRoster();
    }
  }

  return (
    <div className="app">
      <header className="volnav">
        <nav className="vol-links" aria-label="分卷">
          <Link href="/" aria-current="true">晨报</Link>
          <a href="#lede" aria-current={active === "lede" ? "true" : undefined}>判断</a>
          <a href="#movers" aria-current={active === "movers" ? "true" : undefined}>异动</a>
          <a href="#us" aria-current={active === "us" ? "true" : undefined}>美股</a>
          <a href="#hk" aria-current={active === "hk" ? "true" : undefined}>港股</a>
          {report?.catalysts.length ? (
            <a href="#catalysts" aria-current={active === "catalysts" ? "true" : undefined}>日程</a>
          ) : null}
        </nav>
        <div className="vol-actions">
          <button
            ref={rosterBtnRef}
            className="ghost"
            type="button"
            aria-expanded={rosterOpen}
            onClick={() => (rosterOpen ? closeRoster() : openRoster())}
          >
            名单
          </button>
          <button
            className="ghost theme-toggle"
            onClick={toggleTheme}
            type="button"
            aria-pressed={theme === "dark"}
            aria-label={theme === "dark" ? "切换到纸面" : "切换到夜读"}
          >
            {theme === "dark" ? "纸面" : "夜读"}
          </button>
        </div>
      </header>

      {rosterOpen ? (
        <UniversePanel
          open
          payload={universe}
          generating={updating}
          onClose={closeRoster}
          onChanged={onChanged}
        />
      ) : null}

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
            <Briefing report={report} staleStats={universe.staleStats} />
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
