import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertHistoryBounds,
  cutHistory,
  loadSecurityMaster,
  underlyingByAsset,
  type Underlying,
} from "./master";

describe("cutHistory", () => {
  it("discards SPCX bars before 2026-06-12 and keeps that session", () => {
    const bars = [
      { date: "2026-06-11", close: 1 },
      { date: "2026-06-12", close: 2 },
      { date: "2026-06-13", close: 3 },
    ];
    const cut = cutHistory(bars, "2026-06-12");
    assert.deepEqual(
      cut.map((b) => b.date),
      ["2026-06-12", "2026-06-13"],
    );
  });

  it("discards SNDK bars before 2025-02-24 and keeps that session", () => {
    const bars = [
      { date: "2025-02-23", close: 1 },
      { date: "2025-02-24", close: 2 },
      { date: "2025-02-25", close: 3 },
    ];
    const cut = cutHistory(bars, "2025-02-24");
    assert.deepEqual(
      cut.map((b) => b.date),
      ["2025-02-24", "2025-02-25"],
    );
  });

  it("does not cut QQQ or GLD when historyStartDate is null", () => {
    const bars = [
      { date: "2020-01-02", close: 1 },
      { date: "2024-06-01", close: 2 },
    ];
    const qqq = underlyingByAsset("NASDAQ");
    const gld = underlyingByAsset("GOLD");
    assert.ok(qqq);
    assert.ok(gld);
    assert.equal(qqq.historyStartDate ?? null, null);
    assert.equal(gld.historyStartDate ?? null, null);
    assert.deepEqual(cutHistory(bars, qqq.historyStartDate), bars);
    assert.deepEqual(cutHistory(bars, gld.historyStartDate), bars);
    assert.notEqual(cutHistory(bars, null), bars);
  });
});

describe("assertHistoryBounds", () => {
  it("throws when officialFirstSession and historyStartDate disagree", () => {
    const bad: Underlying = {
      id: "SPCX",
      asset: "SPCX",
      name: "SpaceX",
      yahoo: "SPCX",
      market: "US",
      kind: "equity",
      officialFirstSession: "2026-06-12",
      historyStartDate: "2026-06-01",
      identity: ["SpaceX"],
      benchmarks: ["QQQ"],
      notes: [],
    };
    assert.throws(() => assertHistoryBounds(bad), /history bounds disagree/);
  });

  it("accepts matching or unset bounds", () => {
    assert.doesNotThrow(() =>
      assertHistoryBounds({
        id: "SPCX",
        asset: "SPCX",
        name: "SpaceX",
        yahoo: "SPCX",
        market: "US",
        kind: "equity",
        officialFirstSession: "2026-06-12",
        historyStartDate: "2026-06-12",
        identity: ["SpaceX"],
        benchmarks: ["QQQ"],
        notes: [],
      }),
    );
    assert.doesNotThrow(() =>
      assertHistoryBounds({
        id: "QQQ",
        asset: "NASDAQ",
        name: "Invesco QQQ",
        yahoo: "QQQ",
        market: "US",
        kind: "etf",
        officialFirstSession: null,
        historyStartDate: null,
        identity: ["Invesco QQQ"],
        benchmarks: [],
        notes: [],
      }),
    );
  });
});

describe("security master history constants", () => {
  it("matches officialFirstSession constants for SPCX and SNDK", () => {
    const master = loadSecurityMaster();
    const spcx = master.underlyings.find((u) => u.id === "SPCX");
    const sndk = master.underlyings.find((u) => u.id === "SNDK");
    assert.ok(spcx);
    assert.ok(sndk);
    assert.equal(spcx.officialFirstSession, "2026-06-12");
    assert.equal(spcx.historyStartDate, "2026-06-12");
    assert.equal(sndk.officialFirstSession, "2025-02-24");
    assert.equal(sndk.historyStartDate, "2025-02-24");
    for (const u of master.underlyings) {
      assert.doesNotThrow(() => assertHistoryBounds(u));
    }
  });
});
