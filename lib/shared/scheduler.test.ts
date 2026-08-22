import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DayRunRecord } from "./run-lock";
import { shouldRunMorning, shouldRunShort } from "./schedule-policy";

function bjWall(ymd: string, hour: number, minute = 0): Date {
  const utcHour = hour - 8;
  const day = utcHour < 0 ? Number(ymd.slice(8, 10)) - 1 : Number(ymd.slice(8, 10));
  const h = utcHour < 0 ? utcHour + 24 : utcHour;
  const month = ymd.slice(5, 7);
  const year = ymd.slice(0, 4);
  const dd = String(day).padStart(2, "0");
  return new Date(
    `${year}-${month}-${dd}T${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  );
}

const success: DayRunRecord = {
  status: "success",
  runId: "r1",
  finishedAt: "2026-01-06T01:00:00.000Z",
  marketSnapshotId: "ms-1",
};

const failed: DayRunRecord = {
  status: "failed",
  runId: "r2",
  finishedAt: "2026-01-06T01:00:00.000Z",
  error: "boom",
};

const degraded: DayRunRecord = {
  status: "degraded",
  runId: "r3",
  finishedAt: "2026-01-06T01:05:00.000Z",
  marketSnapshotId: "ms-1",
};

describe("schedule-policy", () => {
  it("weekend -> neither", () => {
    const sat = bjWall("2026-01-10", 10);
    assert.equal(shouldRunMorning(sat, null), false);
    assert.equal(shouldRunShort(sat, success, null), false);
  });

  it("Tuesday 08:59 BJ -> neither", () => {
    const early = bjWall("2026-01-06", 8, 59);
    assert.equal(shouldRunMorning(early, null), false);
    assert.equal(shouldRunShort(early, success, null), false);
  });

  it("Tuesday 09:00 BJ, no morning -> morning", () => {
    const nine = bjWall("2026-01-06", 9, 0);
    assert.equal(shouldRunMorning(nine, null), true);
    assert.equal(shouldRunShort(nine, null, null), false);
  });

  it("morning success, no short -> short", () => {
    const nine = bjWall("2026-01-06", 9, 5);
    assert.equal(shouldRunMorning(nine, success), false);
    assert.equal(shouldRunShort(nine, success, null), true);
  });

  it("both present -> neither", () => {
    const nine = bjWall("2026-01-06", 10, 0);
    assert.equal(shouldRunMorning(nine, success), false);
    assert.equal(shouldRunShort(nine, success, degraded), false);
    assert.equal(shouldRunShort(nine, success, success), false);
  });

  it("runs short again when morning publishes a different snapshot", () => {
    const now = bjWall("2026-01-06", 10, 0);
    assert.equal(
      shouldRunShort(
        now,
        { ...success, marketSnapshotId: "ms-2" },
        { ...degraded, marketSnapshotId: "ms-1" },
      ),
      true,
    );
  });

  it("retries only a stale running short record", () => {
    const now = bjWall("2026-01-06", 10, 0);
    const recent: DayRunRecord = {
      status: "running",
      runId: "short-recent",
      startedAt: "2026-01-06T01:50:00.000Z",
      marketSnapshotId: "ms-1",
    };
    const stale: DayRunRecord = {
      ...recent,
      runId: "short-stale",
      startedAt: "2026-01-06T01:30:00.000Z",
    };
    assert.equal(shouldRunShort(now, success, recent), false);
    assert.equal(shouldRunShort(now, success, stale), true);
  });

  it("morning failed -> no short", () => {
    const nine = bjWall("2026-01-06", 9, 30);
    assert.equal(shouldRunMorning(nine, failed), true);
    assert.equal(shouldRunShort(nine, failed, null), false);
  });

  it("retries short when the day's short run failed", () => {
    const nine = bjWall("2026-01-06", 10, 0);
    assert.equal(shouldRunShort(nine, success, failed), true);
    assert.equal(shouldRunShort(nine, success, degraded), false);
  });

  it("failed run backs off and stops after MAX_FAILED_RUN_ATTEMPTS", () => {
    const finished = Date.parse("2026-01-06T01:00:00.000Z");
    const record = (attempts?: number): DayRunRecord => ({
      status: "failed",
      runId: "r",
      finishedAt: new Date(finished).toISOString(),
      error: "boom",
      ...(attempts === undefined ? {} : { attempts }),
    });

    const soon = new Date(finished + 5 * 60 * 1000);
    assert.equal(shouldRunMorning(soon, record()), false);
    assert.equal(shouldRunMorning(soon, record(1)), false);

    const afterFirstBackoff = new Date(finished + 11 * 60 * 1000);
    assert.equal(shouldRunMorning(afterFirstBackoff, record()), true);
    assert.equal(shouldRunMorning(afterFirstBackoff, record(1)), true);

    assert.equal(shouldRunMorning(afterFirstBackoff, record(2)), false);
    const afterSecondBackoff = new Date(finished + 21 * 60 * 1000);
    assert.equal(shouldRunMorning(afterSecondBackoff, record(2)), true);
    assert.equal(shouldRunMorning(afterSecondBackoff, record(3)), false);
  });

  it("failed short with exhausted attempts is not retried", () => {
    const nine = bjWall("2026-01-06", 10, 0);
    assert.equal(shouldRunShort(nine, success, { ...failed, attempts: 3 }), false);
  });
});
