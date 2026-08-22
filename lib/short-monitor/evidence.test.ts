import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { MarketSnapshot } from "../shared/market-snapshot";
import type { DailyBar } from "../types";
import { collectCalendarEvidence } from "./sources/calendar";
import { collectCatalystEvidence } from "./sources/catalyst";
import { hasBlockingEvidenceGap, loadOrCollectEvidenceContext } from "./evidence";
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
  it("falls back to the keyless CSV feed and derives signals when FRED_API_KEY unset", async () => {
    const previous = process.env.FRED_API_KEY;
    delete process.env.FRED_API_KEY;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const id = String(input).match(/id=([A-Z0-9]+)/)?.[1] ?? "";
      const body =
        id === "WALCL"
          ? "observation_date,WALCL\n2025-12-24,6700000\n2025-12-31,6710000"
          : `observation_date,${id}\n2025-12-30,4.60\n2025-12-31,4.70`;
      return new Response(body, { status: 200 });
    };
    try {
      const result = await collectFredEvidence(fakeSnapshot());
      assert.equal(result.items.length, 3);
      const dgs = result.items.find((item) => item.id === "ev-fred-DGS10-2025-12-31");
      assert.ok(dgs);
      assert.equal(dgs.signal, "BEARISH");
      assert.equal(dgs.stale, false);
      assert.ok(dgs.limitations.includes("keyless fredgraph.csv fallback"));
      assert.deepEqual(result.gaps, []);
    } finally {
      if (previous === undefined) delete process.env.FRED_API_KEY;
      else process.env.FRED_API_KEY = previous;
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks per series when the keyless feed is unavailable", async () => {
    const previous = process.env.FRED_API_KEY;
    delete process.env.FRED_API_KEY;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("", { status: 500 });
    try {
      const result = await collectFredEvidence(fakeSnapshot());
      assert.equal(result.items.length, 0);
      assert.ok(result.gaps.length >= 3);
      assert.deepEqual(
        new Set(result.gaps.flatMap((gap) => gap.affectedAssets)),
        new Set(FRED_AFFECTED_ASSETS),
      );
      assert.ok(result.gaps.every((gap) => gap.blocking));
    } finally {
      if (previous === undefined) delete process.env.FRED_API_KEY;
      else process.env.FRED_API_KEY = previous;
      globalThis.fetch = originalFetch;
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

describe("evidence freezing", () => {
  it("flags packets carrying blocking gaps so a transient failure self-heals", () => {
    const gap = (blocking: boolean) => ({
      source: "SEC",
      affectedAssets: ["SPCX" as const],
      capability: "FUNDAMENTAL" as const,
      blocking,
      message: "SEC unavailable",
    });
    assert.equal(hasBlockingEvidenceGap({ gaps: [gap(true)] }), true);
    assert.equal(hasBlockingEvidenceGap({ gaps: [gap(false)] }), false);
    assert.equal(hasBlockingEvidenceGap({ gaps: [] }), false);
  });
});

describe("calendar maintenance warnings", () => {
  it("warns before the static US calendar coverage ends and blocks after", () => {
    const base = fakeSnapshot();
    const nearing = collectCalendarEvidence({
      ...base,
      us: { ...base.us, wallYmd: "2027-12-02", wallKind: "open", lastCompleteYmd: "2027-12-01" },
    });
    assert.ok(
      nearing.gaps.some((gap) => !gap.blocking && gap.message.includes("coverage ends")),
    );
    const expired = collectCalendarEvidence({
      ...base,
      us: { ...base.us, wallYmd: "2028-01-07", wallKind: "open", lastCompleteYmd: "2028-01-06" },
    });
    assert.ok(
      expired.gaps.some((gap) => gap.blocking && gap.message.includes("coverage expired")),
    );
    const current = collectCalendarEvidence(base);
    assert.ok(!current.gaps.some((gap) => gap.message.includes("coverage")));
  });

  it("warns as the catalyst calendar approaches its 45-day staleness window", () => {
    const nearing = collectCatalystEvidence({
      ...fakeSnapshot(),
      beijingDate: "2026-09-20",
      generatedAt: "2026-09-20T01:00:00.000Z",
    });
    assert.ok(
      nearing.gaps.some((gap) => !gap.blocking && gap.message.includes("approaching staleness")),
    );
    const stale = collectCatalystEvidence({
      ...fakeSnapshot(),
      beijingDate: "2026-10-10",
      generatedAt: "2026-10-10T01:00:00.000Z",
    });
    assert.ok(stale.gaps.some((gap) => gap.blocking && gap.message.includes("stale")));
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
