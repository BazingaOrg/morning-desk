import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  classifyUsFreshness,
  loadMarketSnapshot,
  saveMarketSnapshot,
  type MarketSnapshot,
} from "./market-snapshot";

describe("classifyUsFreshness", () => {
  it("returns closed when the report day is a holiday even if last complete bars exist", () => {
    assert.equal(
      classifyUsFreshness({
        reportKind: "closed",
        expectedCompleteSession: "2025-12-31",
        barSession: "2025-12-31",
        lastSuccessSession: "2025-12-31",
        usedStaleCache: false,
        completeKind: "open",
      }),
      "closed",
    );
  });

  it("returns unavailable when no bars on an open day", () => {
    assert.equal(
      classifyUsFreshness({
        reportKind: "open",
        expectedCompleteSession: "2026-01-05",
        barSession: null,
        lastSuccessSession: null,
        usedStaleCache: false,
        completeKind: "open",
      }),
      "unavailable",
    );
  });

  it("returns stale when usedStaleCache even if sessions match", () => {
    assert.equal(
      classifyUsFreshness({
        reportKind: "open",
        expectedCompleteSession: "2026-01-05",
        barSession: "2026-01-05",
        lastSuccessSession: null,
        usedStaleCache: true,
        completeKind: "open",
      }),
      "stale",
    );
  });

  it("returns unchanged when bar already processed", () => {
    assert.equal(
      classifyUsFreshness({
        reportKind: "open",
        expectedCompleteSession: "2026-01-05",
        barSession: "2026-01-05",
        lastSuccessSession: "2026-01-05",
        usedStaleCache: false,
        completeKind: "open",
      }),
      "unchanged",
    );
  });

  it("returns new for first sighting of expected open session", () => {
    assert.equal(
      classifyUsFreshness({
        reportKind: "open",
        expectedCompleteSession: "2026-01-05",
        barSession: "2026-01-05",
        lastSuccessSession: "2026-01-02",
        usedStaleCache: false,
        completeKind: "open",
      }),
      "new",
    );
  });

  it("returns early-close for first sighting of early-close session", () => {
    assert.equal(
      classifyUsFreshness({
        reportKind: "early-close",
        expectedCompleteSession: "2025-07-03",
        barSession: "2025-07-03",
        lastSuccessSession: "2025-07-02",
        usedStaleCache: false,
        completeKind: "early-close",
      }),
      "early-close",
    );
  });

  it("returns stale when barSession mismatches expected", () => {
    assert.equal(
      classifyUsFreshness({
        reportKind: "open",
        expectedCompleteSession: "2026-01-05",
        barSession: "2026-01-02",
        lastSuccessSession: "2026-01-02",
        usedStaleCache: false,
        completeKind: "open",
      }),
      "stale",
    );
  });
});

describe("market snapshot persistence", () => {
  let baseDir: string;

  before(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "morning-desk-snap-"));
  });

  after(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("save then load round-trips and refuses overwrite", async () => {
    const snap: MarketSnapshot = {
      id: "ms-unique-run-1",
      kind: "overnight_snapshot",
      beijingDate: "2026-01-06",
      generatedAt: "2026-01-06T01:00:00.000Z",
      us: {
        sessionDate: "2026-01-05",
        freshness: "new",
        kind: "open",
        wallYmd: "2026-01-05",
        wallKind: "open",
        reportYmd: "2026-01-05",
        reportKind: "open",
        lastCompleteYmd: "2026-01-05",
      },
      hk: {
        sessionDate: null,
        freshness: "unavailable",
      },
    };
    await saveMarketSnapshot(snap, baseDir);
    const loaded = await loadMarketSnapshot(snap.id, baseDir);
    assert.deepEqual(loaded, snap);
    await assert.rejects(() => saveMarketSnapshot(snap, baseDir), /already exists/);
  });

  it("allows exactly one writer when the same snapshot id is saved concurrently", async () => {
    const base: MarketSnapshot = {
      id: "ms-concurrent-run",
      kind: "overnight_snapshot",
      beijingDate: "2026-01-07",
      generatedAt: "2026-01-07T01:00:00.000Z",
      us: {
        sessionDate: "2026-01-06",
        freshness: "new",
        kind: "open",
        wallYmd: "2026-01-06",
        wallKind: "open",
        reportYmd: "2026-01-06",
        reportKind: "open",
        lastCompleteYmd: "2026-01-06",
      },
      hk: { sessionDate: "2026-01-06", freshness: "new" },
    };
    const variants = Array.from({ length: 20 }, (_, index) => ({
      ...base,
      generatedAt: `2026-01-07T01:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    const results = await Promise.allSettled(
      variants.map((snapshot) => saveMarketSnapshot(snapshot, baseDir)),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 19);
    const loaded = await loadMarketSnapshot(base.id, baseDir);
    assert.ok(loaded);
    assert.ok(variants.some((snapshot) => snapshot.generatedAt === loaded.generatedAt));
  });
});
