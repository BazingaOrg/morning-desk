import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { DayRunRecord } from "../shared/run-lock";
import {
  loadCurrentShortMonitorReport,
  loadShortMonitorReport,
  saveShortMonitorRun,
} from "./run-store";
import type { ShortMonitorReport } from "./types";

function report(runId: string): ShortMonitorReport {
  return {
    runId,
    beijingDate: "2026-08-20",
    marketSnapshotId: "ms-morning-1",
    overnight_snapshot: true,
    dataCutoff: {
      snapshotGeneratedAt: "2026-08-20T01:00:00.000Z",
      evidenceCollectedAt: "2026-08-20T01:00:30.000Z",
      usSession: "2026-08-19",
      usFreshness: "new",
      usReportKind: "open",
    },
    position: "FLAT",
    evidence: [],
    gaps: [],
    catalysts7d: [],
    catalysts30d: [],
    historyChanges: [],
    decision: {
      runId,
      marketSnapshotId: "ms-morning-1",
      position: "FLAT",
      action: "WAIT",
      bestOpportunity: "None",
      assets: [],
      degradations: [],
      generatedAt: "2026-08-20T01:01:00.000Z",
    },
    modelOutput: null,
    status: "degraded",
    degradationReason: "model unavailable",
    generatedAt: "2026-08-20T01:01:00.000Z",
  };
}

describe("short-monitor immutable run store", () => {
  let baseDir: string;

  before(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "morning-desk-short-store-"));
  });

  after(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("publishes one immutable run and records audit metadata", async () => {
    const runId = "short-2026-08-20-immutable";
    const payload = report(runId);
    const save = () => saveShortMonitorRun({
      runId,
      report: payload,
      evidence: [],
      derived: { gaps: [] },
      modelOutput: null,
      decision: payload.decision,
      audit: {
        pipelineId: "short-monitor",
        beijingDate: payload.beijingDate,
        startedAt: "2026-08-20T01:00:00.000Z",
        finishedAt: payload.generatedAt,
        dataCutoff: payload.dataCutoff,
        promptHash: "abc123",
        promptVersion: 1,
        model: "deepseek-chat",
        attempts: 1,
        schemaVersion: 1,
        scoreVersion: 1,
        sourcesUsed: ["test"],
        gaps: [],
      },
      baseDir,
    });
    const results = await Promise.allSettled([save(), save()]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const manifest = JSON.parse(
      await fs.readFile(path.join(baseDir, "runs", runId, "manifest.json"), "utf8"),
    ) as { promptHash: string; scoreVersion: number; marketSnapshotId: string };
    assert.equal(manifest.promptHash, "abc123");
    assert.equal(manifest.scoreVersion, 1);
    assert.equal(manifest.marketSnapshotId, "ms-morning-1");
    assert.deepEqual(await loadShortMonitorReport(baseDir), payload);
    const leftover = await fs.readdir(path.join(baseDir, "runs"));
    assert.equal(leftover.some((name) => name.startsWith(".claim-")), false);
  });

  it("never treats yesterday latest or today's failed run as current", async () => {
    const failed: DayRunRecord = {
      status: "failed",
      runId: "short-today-failed",
      finishedAt: "2026-08-21T01:01:00.000Z",
      marketSnapshotId: "ms-morning-2",
      error: "failed",
    };
    assert.equal(
      await loadCurrentShortMonitorReport({
        beijingDate: "2026-08-21",
        morningSnapshotId: "ms-morning-2",
        dayRun: failed,
        baseDir,
      }),
      null,
    );
  });

  it("loads current only when date, run and morning snapshot all match", async () => {
    const dayRun: DayRunRecord = {
      status: "degraded",
      runId: "short-2026-08-20-immutable",
      finishedAt: "2026-08-20T01:01:00.000Z",
      marketSnapshotId: "ms-morning-1",
    };
    assert.ok(await loadCurrentShortMonitorReport({
      beijingDate: "2026-08-20",
      morningSnapshotId: "ms-morning-1",
      dayRun,
      baseDir,
    }));
    assert.equal(await loadCurrentShortMonitorReport({
      beijingDate: "2026-08-20",
      morningSnapshotId: "ms-another",
      dayRun,
      baseDir,
    }), null);
  });
});
