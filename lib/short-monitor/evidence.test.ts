import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { MarketSnapshot } from "../shared/market-snapshot";
import type { DailyBar } from "../types";
import { collectCalendarEvidence } from "./sources/calendar";
import { collectCatalystEvidence } from "./sources/catalyst";
import { loadOrCollectEvidenceContext } from "./evidence";
import { collectFredEvidence, FRED_AFFECTED_ASSETS } from "./sources/fred";
import { collectMarketContext, priceConfirmed } from "./sources/market";

function fakeSnapshot(partial?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    id: "ms-test-evidence",
    kind: "overnight_snapshot",
    beijingDate: "2026-01-02",
    generatedAt: "2026-01-02T01:00:00.000Z",
    us: {
      sessionDate: null,
      freshness: "closed",
      kind: "closed",
      wallYmd: "2026-01-01",
      wallKind: "closed",
      reportYmd: "2026-01-01",
      reportKind: "closed",
      lastCompleteYmd: "2025-12-31",
    },
    hk: {
      sessionDate: null,
      freshness: "unavailable",
    },
    ...partial,
  };
}

describe("FRED gaps", () => {
  it("treats a missing API key as blocking for every FRED-relevant asset", async () => {
    const previous = process.env.FRED_API_KEY;
    delete process.env.FRED_API_KEY;
    try {
      const result = await collectFredEvidence(fakeSnapshot());
      assert.deepEqual(
        new Set(result.gaps[0]?.affectedAssets),
        new Set(FRED_AFFECTED_ASSETS),
      );
      assert.deepEqual(new Set(FRED_AFFECTED_ASSETS), new Set(["SPCX", "SNDK", "NASDAQ", "GOLD"]));
      assert.equal(result.gaps[0]?.blocking, true);
      assert.equal(result.items.length, 0);
    } finally {
      if (previous === undefined) delete process.env.FRED_API_KEY;
      else process.env.FRED_API_KEY = previous;
    }
  });
});

describe("collectCalendarEvidence", () => {
  it("emits wall and last-complete items for closed wall / 2025-12-31 complete", () => {
    const snapshot = fakeSnapshot();
    const result = collectCalendarEvidence(snapshot);
    const wall = result.items.find((i) => i.id === "ev-cal-us-wall-2026-01-01");
    const complete = result.items.find(
      (i) => i.id === "ev-cal-us-complete-2025-12-31",
    );
    assert.ok(wall);
    assert.equal(wall.kind, "session-wall");
    assert.equal(wall.asset, "MACRO");
    assert.equal(wall.verified, true);
    assert.equal(wall.sourceName, "NYSE/Nasdaq calendar");
    assert.ok(complete);
    assert.equal(complete.kind, "last-complete-session");
    assert.equal(complete.period, "2025-12-31");
  });
});

describe("priceConfirmed", () => {
  it("returns false when fewer than 20 bars", () => {
    const bars: DailyBar[] = [];
    for (let i = 1; i <= 10; i += 1) {
      bars.push({
        date: `2025-12-${String(i).padStart(2, "0")}`,
        open: 10,
        high: 11,
        low: 9,
        close: 10 - i * 0.1,
        adjClose: null,
        volume: 1000,
      });
    }
    assert.equal(priceConfirmed(bars, "2025-12-10"), false);
  });
});

describe("frozen market input", () => {
  it("fails closed instead of refetching when the morning snapshot has no captured series", async () => {
    const result = await collectMarketContext(fakeSnapshot());
    assert.equal(result.items.length, 0);
    assert.ok(result.gaps.some((entry) => entry.message.includes("frozen short-monitor market series")));
  });

  it("reuses the frozen Evidence Packet for retries of the same snapshot", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "morning-desk-evidence-freeze-"));
    const snapshot = fakeSnapshot();
    const frozen = {
      snapshotId: snapshot.id,
      collectedAt: "2026-01-02T01:02:00.000Z",
      packet: { items: [], gaps: [], sourcesUsed: [] },
      market: {
        items: [],
        gaps: [],
        sourcesUsed: [],
        assetPacks: {
          SPCX: { bars: [], stale: false, session: null, dataConflict: false },
          SNDK: { bars: [], stale: false, session: null, dataConflict: false },
          NASDAQ: { bars: [], stale: false, session: null, dataConflict: false },
          GOLD: { bars: [], stale: false, session: null, dataConflict: false },
        },
      },
    };
    const file = path.join(baseDir, "short-monitor", "evidence-snapshots", `${snapshot.id}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(frozen));
    try {
      const loaded = await loadOrCollectEvidenceContext(snapshot, baseDir);
      assert.equal(loaded.cacheHit, true);
      assert.deepEqual(
        {
          snapshotId: loaded.snapshotId,
          collectedAt: loaded.collectedAt,
          packet: loaded.packet,
          market: loaded.market,
        },
        frozen,
      );
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});

describe("collectCatalystEvidence", () => {
  it("emits only upcoming dates within 30 days of beijingDate", () => {
    const snapshot = fakeSnapshot({
      beijingDate: "2026-09-01",
      generatedAt: "2026-09-01T01:00:00.000Z",
    });
    const result = collectCatalystEvidence(snapshot);
    assert.ok(result.items.length > 0);
    for (const item of result.items) {
      assert.ok(item.period);
      assert.ok(item.period >= "2026-09-01");
      assert.ok(item.period <= "2026-10-01");
      assert.equal(item.sourceName, "static official calendar");
    }
    const past = result.items.find((i) => i.period === "2026-07-29");
    assert.equal(past, undefined);
    const fomc = result.items.find((i) => i.id === "ev-cat-fomc-2026-09-16");
    assert.ok(fomc);
  });
});
