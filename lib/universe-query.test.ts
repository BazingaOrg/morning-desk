import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DailyReport, UniverseItem } from "./types";
import { presentReport } from "./universe-query";

function item(partial: Partial<UniverseItem> & Pick<UniverseItem, "id" | "market" | "name">): UniverseItem {
  return {
    display: partial.display ?? partial.id,
    yahoo: partial.yahoo ?? partial.id,
    benchmark: partial.benchmark ?? "VOO",
    group: partial.group ?? "测试",
    notes: partial.notes ?? [],
    identity: partial.identity ?? [],
    ...partial,
  };
}

function report(over: Partial<DailyReport> = {}): DailyReport {
  return {
    title: "晨间值守",
    beijingDate: "2026-08-30",
    generatedAt: "2026/08/30 21:40:40",
    timezone: "Asia/Shanghai",
    closedBoth: false,
    us: { market: "US", sessionDate: "2026-08-28", isNew: false, closed: false, label: "US", freshness: "stale" },
    hk: { market: "HK", sessionDate: "2026-08-28", isNew: false, closed: false, label: "HK", freshness: "unchanged" },
    chops: [],
    conclusion: [],
    movers: [],
    usRows: [],
    hkRows: [],
    catalysts: [],
    audit: {
      generatedAt: "2026/08/30 21:40:40",
      sources: [],
      gaps: [],
      holidays: [],
      identityFlags: [],
      unfinished: [],
    },
    ...over,
  };
}

describe("presentReport", () => {
  it("replaces US quote translations with the universe English name", () => {
    const served = presentReport(
      report({
        usRows: [
          {
            id: "INTU",
            display: "INTU",
            name: "财捷",
            yahoo: "INTU",
            market: "US",
            group: "软件",
            close: 1,
            ret1D: null,
            ret5D: null,
            ret10D: null,
            ret20D: null,
            retYtd: null,
            sinceListing: null,
            ytdLabel: "YTD",
            excess10D: null,
            volumeRatio: null,
            volumeClass: null,
            dist52W: null,
            tag: "正常",
            sessionDate: "2026-08-28",
            listed: true,
            halted: false,
            identityOk: true,
            usedAdjusted: false,
            notes: [],
            moverReasons: [],
            sources: [],
          },
        ],
        movers: [
          {
            id: "INTU",
            display: "INTU",
            name: "财捷",
            ret1D: null,
            ret10D: null,
            excess10D: null,
            volumeRatio: null,
            nature: "重点关注",
            reason: "规则",
            tag: "重点关注",
          },
        ],
      }),
      [item({ id: "INTU", market: "US", name: "Intuit" })],
    );
    assert.equal(served.usRows[0].name, "Intuit");
    assert.equal(served.movers[0].name, "Intuit");
  });

  it("leaves HK quote names alone", () => {
    const served = presentReport(
      report({
        hkRows: [
          {
            id: "01024",
            display: "01024.HK",
            name: "快手-W",
            yahoo: "1024.HK",
            market: "HK",
            group: "港股互联网",
            close: 1,
            ret1D: null,
            ret5D: null,
            ret10D: null,
            ret20D: null,
            retYtd: null,
            sinceListing: null,
            ytdLabel: "YTD",
            excess10D: null,
            volumeRatio: null,
            volumeClass: null,
            dist52W: null,
            tag: "正常",
            sessionDate: "2026-08-28",
            listed: true,
            halted: false,
            identityOk: true,
            usedAdjusted: false,
            notes: [],
            moverReasons: [],
            sources: [],
          },
        ],
      }),
      [item({ id: "01024", display: "01024.HK", yahoo: "1024.HK", market: "HK", name: "快手-W" })],
    );
    assert.equal(served.hkRows[0].name, "快手-W");
  });
});
