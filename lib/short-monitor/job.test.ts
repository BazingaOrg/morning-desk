import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { readDayRun, releaseRunLock, writeDayRun } from "../shared/run-lock";
import { claimShortMonitorRun, executeShortMonitorClaim } from "./job";

describe("short-monitor job claim", () => {
  let baseDir: string;
  const now = new Date("2026-08-20T01:00:00.000Z");
  const bj = "2026-08-20";

  before(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "morning-desk-short-job-"));
    await writeDayRun("morning", bj, {
      status: "success",
      runId: "morning-1",
      finishedAt: now.toISOString(),
      marketSnapshotId: "ms-morning-1",
    }, baseDir);
  });

  after(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("allows exactly one concurrent claimant", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => claimShortMonitorRun(now, { baseDir })),
    );
    const started = results.filter((result) => result.status === "started");
    assert.equal(started.length, 1);
    assert.equal(results.filter((result) => result.status === "busy").length, 11);
    const winner = started[0];
    if (winner.status === "started") await releaseRunLock(winner.claim.lock);
  });

  it("does not repeat a terminal run for the same snapshot", async () => {
    await writeDayRun("short-monitor", bj, {
      status: "degraded",
      runId: "short-existing",
      finishedAt: now.toISOString(),
      marketSnapshotId: "ms-morning-1",
    }, baseDir);
    const result = await claimShortMonitorRun(now, { baseDir, retryFailed: true });
    assert.equal(result.status, "complete");
  });

  it("requires explicit retry authority after failure", async () => {
    await writeDayRun("short-monitor", bj, {
      status: "failed",
      runId: "short-failed",
      finishedAt: now.toISOString(),
      marketSnapshotId: "ms-morning-1",
      error: "failed",
    }, baseDir);
    const scheduler = await claimShortMonitorRun(now, { baseDir });
    assert.equal(scheduler.status, "failed");
    const manual = await claimShortMonitorRun(now, { baseDir, retryFailed: true });
    assert.equal(manual.status, "started");
    if (manual.status === "started") await releaseRunLock(manual.claim.lock);
  });

  it("records pipeline failure without changing the morning day-run", async () => {
    const failureDate = "2026-08-21";
    const failureNow = new Date("2026-08-21T01:00:00.000Z");
    const morning = {
      status: "success" as const,
      runId: "morning-failure-test",
      finishedAt: failureNow.toISOString(),
      marketSnapshotId: "ms-missing-snapshot",
    };
    await writeDayRun("morning", failureDate, morning, baseDir);
    const claimed = await claimShortMonitorRun(failureNow, { baseDir });
    assert.equal(claimed.status, "started");
    if (claimed.status !== "started") return;
    await assert.rejects(() => executeShortMonitorClaim(claimed.claim), /market snapshot not found/);
    assert.deepEqual(await readDayRun("morning", failureDate, baseDir), morning);
    const failed = await readDayRun("short-monitor", failureDate, baseDir);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.marketSnapshotId, "ms-missing-snapshot");
  });
});
