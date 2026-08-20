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

  it("morning failed -> no short", () => {
    const nine = bjWall("2026-01-06", 9, 30);
    assert.equal(shouldRunMorning(nine, failed), true);
    assert.equal(shouldRunShort(nine, failed, null), false);
  });
});
