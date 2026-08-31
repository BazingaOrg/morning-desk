import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  loadMorningReportRun,
  loadMorningReportRunAudit,
  saveMorningReportRun,
  saveReport,
} from "./store";
import type { DailyReport } from "./types";

function report(beijingDate: string): DailyReport {
  return {
    title: "晨间值守",
    beijingDate,
    generatedAt: `${beijingDate} 09:00:00`,
    timezone: "Asia/Shanghai",
    closedBoth: false,
    us: { market: "US", sessionDate: beijingDate, isNew: true, closed: false, label: "US", freshness: "new" },
    hk: { market: "HK", sessionDate: beijingDate, isNew: true, closed: false, label: "HK", freshness: "new" },
    chops: [],
    conclusion: [],
    movers: [],
    usRows: [],
    hkRows: [],
    catalysts: [],
    audit: {
      generatedAt: `${beijingDate} 09:00:00`,
      sources: ["test-source"],
      gaps: [],
      holidays: [],
      identityFlags: [],
      unfinished: [],
    },
  };
}

describe("morning report immutable run store", () => {
  let baseDir: string;

  before(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "morning-desk-report-store-"));
  });

  after(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("archives report and audit before atomically publishing latest", async () => {
    const runId = "morning-2026-08-21-immutable";
    const payload = report("2026-08-21");
    await saveMorningReportRun({
      runId,
      report: payload,
      baseDir,
    });

    assert.deepEqual(await loadMorningReportRun(runId, baseDir), payload);
    assert.deepEqual(await loadLatestReportAt(baseDir), payload);
    assert.deepEqual(await loadMorningReportRunAudit(runId, baseDir), {
      pipelineId: "morning",
      runId,
      beijingDate: "2026-08-21",
      generatedAt: "2026-08-21 09:00:00",
      reportAudit: payload.audit,
    });
  });

  it("rejects duplicate run ids without replacing an archived report or latest", async () => {
    const runId = "morning-2026-08-21-duplicate";
    const original = report("2026-08-21");
    await saveMorningReportRun({
      runId,
      report: original,
      baseDir,
    });

    const replacement = { ...report("2026-08-22"), title: "replacement" };
    await assert.rejects(
      () => saveMorningReportRun({ runId, report: replacement, baseDir }),
      /already exists/,
    );

    assert.deepEqual(await loadMorningReportRun(runId, baseDir), original);
    assert.deepEqual(await loadLatestReportAt(baseDir), original);
  });

  it("keeps the legacy latest writer available", async () => {
    const payload = report("2026-08-23");
    await saveReport(payload, baseDir);
    assert.deepEqual(await loadLatestReportAt(baseDir), payload);
  });
});

async function loadLatestReportAt(baseDir: string): Promise<DailyReport | null> {
  const raw = await fs.readFile(path.join(baseDir, "latest.json"), "utf8");
  return JSON.parse(raw) as DailyReport;
}
