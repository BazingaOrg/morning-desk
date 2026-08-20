import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFirstUsSessionOfWeek,
  lastCompletedUsSession,
  loadUsCalendar,
  previousUsSession,
  usMarketClock,
  usSessionKind,
} from "./calendar";

describe("us market calendar", () => {
  it("marks 2026-01-01 closed", () => {
    assert.equal(usSessionKind("2026-01-01"), "closed");
    assert.ok(loadUsCalendar().holidays.has("2026-01-01"));
  });

  it("marks 2026-07-03 as full holiday (Independence Day observed), not early close", () => {
    assert.equal(usSessionKind("2026-07-03"), "closed");
    assert.ok(loadUsCalendar().holidays.has("2026-07-03"));
    assert.equal(loadUsCalendar().earlyCloses.has("2026-07-03"), false);
  });

  it("marks listed early closes", () => {
    assert.equal(usSessionKind("2025-07-03"), "early-close");
    assert.equal(usSessionKind("2026-11-27"), "early-close");
    assert.equal(usSessionKind("2026-12-24"), "early-close");
  });

  it("marks Saturday closed", () => {
    assert.equal(usSessionKind("2026-01-03"), "closed");
  });

  it("marks Sunday closed", () => {
    assert.equal(usSessionKind("2026-01-04"), "closed");
  });

  it("previousUsSession skips weekend and holidays", () => {
    assert.equal(previousUsSession("2026-01-02"), "2025-12-31");
    assert.equal(previousUsSession("2026-07-06"), "2026-07-02");
  });

  it("lastCompletedUsSession on Tuesday 09:00 Asia/Shanghai is Monday when Monday was open", () => {
    // 2026-01-06 Tue 09:00 Asia/Shanghai = 2026-01-06T01:00:00.000Z
    // America/New_York is still Monday evening 2026-01-05
    const now = new Date("2026-01-06T01:00:00.000Z");
    const done = lastCompletedUsSession(now);
    assert.equal(done.ymd, "2026-01-05");
    assert.equal(done.kind, "open");
  });

  it("lastCompletedUsSession after regular close returns that day", () => {
    // Monday 2026-01-05 21:10 UTC = 16:10 ET (EST)
    const now = new Date("2026-01-05T21:10:00.000Z");
    const done = lastCompletedUsSession(now);
    assert.equal(done.ymd, "2026-01-05");
    assert.equal(done.kind, "open");
  });

  it("isFirstUsSessionOfWeek is true on Monday after Friday", () => {
    assert.equal(isFirstUsSessionOfWeek("2026-01-05"), true);
    assert.equal(isFirstUsSessionOfWeek("2026-01-06"), false);
  });

  it("usMarketClock on US New Year evening reports closed wall and prior complete session", () => {
    const now = new Date("2026-01-02T01:00:00.000Z");
    const clock = usMarketClock(now);
    assert.equal(clock.wallYmd, "2026-01-01");
    assert.equal(clock.wallKind, "closed");
    assert.equal(clock.reportYmd, "2026-01-01");
    assert.equal(clock.reportKind, "closed");
    assert.equal(clock.lastComplete.ymd, "2025-12-31");
    assert.equal(clock.lastComplete.kind, "open");
  });

  it("Monday Beijing 09:00 reports the prior Friday instead of the US Sunday wall day", () => {
    const clock = usMarketClock(new Date("2026-01-05T01:00:00.000Z"));
    assert.equal(clock.wallYmd, "2026-01-04");
    assert.equal(clock.wallKind, "closed");
    assert.equal(clock.reportYmd, "2026-01-02");
    assert.equal(clock.reportKind, "open");
    assert.equal(clock.lastComplete.ymd, "2026-01-02");
  });

  it("Monday Beijing 09:00 preserves a prior Friday early close", () => {
    const clock = usMarketClock(new Date("2026-11-30T01:00:00.000Z"));
    assert.equal(clock.wallYmd, "2026-11-29");
    assert.equal(clock.reportYmd, "2026-11-27");
    assert.equal(clock.reportKind, "early-close");
    assert.equal(clock.lastComplete.ymd, "2026-11-27");
    assert.equal(clock.lastComplete.kind, "early-close");
  });

  it("Monday Beijing 09:00 preserves a prior Friday full closure", () => {
    const clock = usMarketClock(new Date("2026-07-06T01:00:00.000Z"));
    assert.equal(clock.wallYmd, "2026-07-05");
    assert.equal(clock.reportYmd, "2026-07-03");
    assert.equal(clock.reportKind, "closed");
    assert.equal(clock.lastComplete.ymd, "2026-07-02");
  });
});
