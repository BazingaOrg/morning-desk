import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { usMarketClock, usSessionKind } from "../shared/calendar";
import { classifyUsFreshness } from "../shared/market-snapshot";
import { nextSessionWaterline } from "../shared/session";
import { atr, sma } from "./features";
import { cutHistory } from "./master";
import type { ShortMonitorFixture } from "./types";

const DIR = path.join(process.cwd(), "data", "short-monitor", "fixtures");

function load(id: string): ShortMonitorFixture {
  return JSON.parse(readFileSync(path.join(DIR, `${id}.json`), "utf8")) as ShortMonitorFixture;
}

describe("fixture acceptance", () => {
  it("02-full-close: holiday wall is closed and does not advance waterline", () => {
    const fixture = load("02-full-close");
    assert.equal(fixture.session.freshness, "closed");
    assert.equal(usSessionKind("2026-07-03"), "closed");
    const clock = usMarketClock(new Date("2026-07-06T01:00:00.000Z"));
    assert.equal(clock.reportYmd, "2026-07-03");
    assert.equal(clock.reportKind, "closed");
    const freshness = classifyUsFreshness({
      reportKind: clock.reportKind,
      expectedCompleteSession: "2026-07-02",
      barSession: "2026-07-02",
      lastSuccessSession: "2026-07-02",
      usedStaleCache: false,
      completeKind: "open",
    });
    assert.equal(freshness, "closed");
    assert.notEqual(freshness, "new");
    assert.equal(
      nextSessionWaterline("2026-07-02", "2026-07-02", freshness),
      "2026-07-02",
    );
  });

  it("03-early-close: 2026-11-27 is early close, 11-26 is full holiday", () => {
    const fixture = load("03-early-close");
    assert.equal(fixture.session.usSession.date, "2026-11-27");
    assert.equal(fixture.session.usSession.kind, "early-close");
    assert.equal(usSessionKind("2026-11-26"), "closed");
    assert.equal(usSessionKind("2026-11-27"), "early-close");
    const clock = usMarketClock(new Date("2026-11-30T01:00:00.000Z"));
    assert.equal(clock.reportYmd, "2026-11-27");
    assert.equal(clock.reportKind, "early-close");
    assert.equal(
      classifyUsFreshness({
        reportKind: clock.reportKind,
        expectedCompleteSession: "2026-11-27",
        barSession: "2026-11-27",
        lastSuccessSession: "2026-11-25",
        usedStaleCache: false,
        completeKind: "early-close",
      }),
      "early-close",
    );
  });

  it("08-history-cut: drops pre-start bars and long indicators are N/A", () => {
    const fixture = load("08-history-cut");
    assert.ok(fixture.sampleBars);
    const spcx = cutHistory(
      fixture.sampleBars.SPCX.inputDates.map((date) => ({ date })),
      fixture.sampleBars.SPCX.historyStartDate,
    );
    assert.deepEqual(
      spcx.map((b) => b.date),
      fixture.sampleBars.SPCX.expectedRemainingDates,
    );
    const sndk = cutHistory(
      fixture.sampleBars.SNDK.inputDates.map((date) => ({ date })),
      fixture.sampleBars.SNDK.historyStartDate,
    );
    assert.deepEqual(
      sndk.map((b) => b.date),
      fixture.sampleBars.SNDK.expectedRemainingDates,
    );
    const closes = spcx.map(() => 100);
    assert.equal(sma(closes, 20), null);
    assert.equal(sma(closes, 50), null);
    assert.equal(sma(closes, 200), null);
    assert.equal(
      atr(
        spcx.map(() => ({ high: 101, low: 99, close: 100 })),
        14,
      ),
      null,
    );
  });

  it("09-morning-ok-ai-timeout: morning stays published while short-monitor degrades", () => {
    const fixture = load("09-morning-ok-ai-timeout");
    assert.equal(fixture.session.morningPublished, true);
    assert.equal(fixture.session.shortMonitorStatus, "degraded");
    assert.ok(fixture.session.degradationReason);
    assert.ok(fixture.session.marketSnapshotId);
    assert.notEqual(fixture.session.shortMonitorStatus, "ok");
  });
});
