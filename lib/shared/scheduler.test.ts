import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DayRunRecord } from "./run-lock";
import { shouldRunMorning } from "./schedule-policy";

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
};

describe("schedule-policy", () => {
  it("runs only on weekdays at or after 09:00 Beijing", () => {
    assert.equal(shouldRunMorning(bjWall("2026-01-10", 10), null), false);
    assert.equal(shouldRunMorning(bjWall("2026-01-06", 8, 59), null), false);
    assert.equal(shouldRunMorning(bjWall("2026-01-06", 9), null), true);
    assert.equal(shouldRunMorning(bjWall("2026-01-06", 9), success), false);
  });

  it("backs off failed runs and stops after three attempts", () => {
    const finished = Date.parse("2026-01-06T01:00:00.000Z");
    const record = (attempts?: number): DayRunRecord => ({
      status: "failed",
      runId: "r",
      finishedAt: new Date(finished).toISOString(),
      error: "boom",
      ...(attempts === undefined ? {} : { attempts }),
    });

    assert.equal(shouldRunMorning(new Date(finished + 5 * 60 * 1000), record()), false);
    assert.equal(shouldRunMorning(new Date(finished + 11 * 60 * 1000), record()), true);
    assert.equal(shouldRunMorning(new Date(finished + 11 * 60 * 1000), record(2)), false);
    assert.equal(shouldRunMorning(new Date(finished + 21 * 60 * 1000), record(2)), true);
    assert.equal(shouldRunMorning(new Date(finished + 21 * 60 * 1000), record(3)), false);
  });
});
