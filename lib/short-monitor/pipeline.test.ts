import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyClusterRisk,
  bestOpportunity,
  pickTool,
  priceFeatureSnapshot,
  priceRelatedVetoes,
  priceScoringEligibility,
  rankAction,
} from "./pipeline";
import type { AssetDecision, EvidenceItem } from "./types";
import type { MarketSnapshot } from "../shared/market-snapshot";

function row(partial: Partial<AssetDecision> & Pick<AssetDecision, "asset">): AssetDecision {
  return {
    state: "WATCH",
    score: 10,
    action: "WAIT",
    vetoes: [],
    rr: null,
    priceConfirmation: "NONE",
    trigger: null,
    executionTool: null,
    stop: null,
    exit: null,
    reason: "test",
    ...partial,
  };
}

function snapshot(freshness: MarketSnapshot["us"]["freshness"]): MarketSnapshot {
  return {
    id: "ms-price-test",
    kind: "overnight_snapshot",
    beijingDate: "2026-08-20",
    generatedAt: "2026-08-20T01:00:00.000Z",
    us: {
      sessionDate: "2026-08-19",
      freshness,
      kind: freshness === "closed" ? "closed" : "open",
      wallYmd: "2026-08-19",
      wallKind: freshness === "closed" ? "closed" : "open",
      reportYmd: "2026-08-19",
      reportKind: freshness === "closed" ? "closed" : "open",
      lastCompleteYmd: "2026-08-19",
    },
    hk: { sessionDate: null, freshness: "unavailable" },
  };
}

describe("pipeline ranking", () => {
  it("rankAction prefers risk-off then ENTER and PREPARE", () => {
    assert.equal(
      rankAction([row({ asset: "SPCX", action: "WAIT" }), row({ asset: "GOLD", action: "PREPARE" })]),
      "PREPARE",
    );
    assert.equal(
      rankAction([row({ asset: "SPCX", action: "ENTER" }), row({ asset: "GOLD", action: "EXIT" })]),
      "EXIT",
    );
    assert.equal(
      rankAction([row({ asset: "SPCX", action: "HOLD" }), row({ asset: "GOLD", action: "REDUCE" })]),
      "REDUCE",
    );
  });

  it("bestOpportunity is None unless an executable ENTER remains", () => {
    assert.equal(
      bestOpportunity([row({ asset: "SPCX", state: "WATCH", action: "WAIT" })]),
      "None",
    );
    assert.equal(
      bestOpportunity([
        row({ asset: "SNDK", state: "TRIGGERED", action: "PREPARE", score: 82 }),
        row({ asset: "SPCX", state: "TRIGGERED", action: "ENTER", score: 90 }),
      ]),
      "SPCX",
    );
    assert.equal(
      bestOpportunity([
        row({ asset: "SPCX", state: "TRIGGERED", action: "EXIT", score: 95 }),
        row({ asset: "SNDK", state: "TRIGGERED", action: "HOLD", score: 90 }),
      ]),
      "None",
    );
  });

  it("keeps at most two executable entries in the shared growth cluster", () => {
    const result = applyClusterRisk([
      row({ asset: "SPCX", state: "TRIGGERED", action: "ENTER", score: 88, rr: 2.2, executionTool: "SSPC" }),
      row({ asset: "SNDK", state: "TRIGGERED", action: "ENTER", score: 88, rr: 3, executionTool: "SNDQ" }),
      row({ asset: "NASDAQ", state: "TRIGGERED", action: "ENTER", score: 84, rr: 4, executionTool: "QID" }),
      row({ asset: "GOLD", state: "TRIGGERED", action: "ENTER", score: 81, rr: 2.5, executionTool: "GLL" }),
    ]);
    assert.deepEqual(result.downgradedAssets, ["NASDAQ"]);
    const nasdaq = result.assets.find((asset) => asset.asset === "NASDAQ");
    assert.equal(nasdaq?.action, "PREPARE");
    assert.equal(nasdaq?.executionTool, null);
    assert.ok(nasdaq?.vetoes.includes("cluster-overlap"));
    assert.equal(result.assets.find((asset) => asset.asset === "GOLD")?.action, "ENTER");
  });

  it("archives the minimum deterministic price feature snapshot", () => {
    const bars = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      open: 120 - index,
      high: 121 - index,
      low: 118 - index,
      close: 120 - index,
      adjClose: 120 - index,
      volume: 1000,
    }));
    const features = priceFeatureSnapshot(bars, "2026-07-20", true);
    assert.equal(features.lastClose, 101);
    assert.equal(features.dma20, 110.5);
    assert.ok(features.ret1D !== null && features.ret1D < 0);
    assert.ok(features.atr14 !== null);
    assert.equal(features.swingHigh20, 121);
    assert.ok(features.target2Atr !== null);
  });

  it("pickTool requires the tool's own verified session close", () => {
    const quote: EvidenceItem = {
      id: "ev-tool-SSPC-close-2026-08-19",
      asset: "SPCX",
      kind: "execution-tool-close",
      observedAt: "2026-08-20T01:00:00.000Z",
      period: "2026-08-19",
      sourceTier: 3,
      sourceName: "test",
      sourceUrl: "https://example.com",
      title: "SSPC close",
      summary: "test",
      verified: true,
      stale: false,
      cluster: "MARKET",
      signal: "CONTEXT",
      relevantAssets: ["SPCX"],
      limitations: [],
    };
    assert.equal(pickTool("SPCX", [quote], "2026-08-19"), "SSPC");
    assert.equal(pickTool("SPCX", [{ ...quote, stale: true }], "2026-08-19"), null);
    assert.equal(pickTool("SPCX", [quote], "2026-08-18"), null);
  });

  it("disables price scoring for closed, unchanged, stale and mismatched sessions", () => {
    assert.equal(
      priceScoringEligibility(snapshot("closed"), { stale: false, session: "2026-08-19" }).eligible,
      false,
    );
    assert.equal(
      priceScoringEligibility(snapshot("unchanged"), { stale: false, session: "2026-08-19" }).eligible,
      false,
    );
    assert.equal(
      priceScoringEligibility(snapshot("new"), { stale: true, session: "2026-08-19" }).eligible,
      false,
    );
    assert.equal(
      priceScoringEligibility(snapshot("new"), { stale: false, session: "2026-08-18" }).eligible,
      false,
    );
  });

  it("closed sessions only carry the closed reason, not stale/tool/rr labels", () => {
    assert.deepEqual(
      priceRelatedVetoes({
        eligible: false,
        reason: "closed-session",
        stale: false,
        barCount: 5,
        tool: null,
        rr: null,
      }),
      {
        staleData: false,
        historyShort: false,
        toolStaleOrUnverified: false,
        rrMissingOrBelowMin: false,
        dataConflict: false,
        binaryEventNear: false,
        leverageDecayHigh: false,
        extra: ["closed-session"],
      },
    );
  });

  it("wires deterministic conflict, binary-event and leverage-decay veto flags", () => {
    const result = priceRelatedVetoes({
      eligible: true,
      reason: null,
      stale: false,
      barCount: 40,
      tool: "QID",
      rr: 3,
      dataConflict: true,
      binaryEventNear: true,
      leverageDecayHigh: true,
    });
    assert.equal(result.dataConflict, true);
    assert.equal(result.binaryEventNear, true);
    assert.equal(result.leverageDecayHigh, true);
  });

  it("allows an aligned early-close session", () => {
    const early = snapshot("early-close");
    early.us.kind = "early-close";
    early.us.wallKind = "early-close";
    early.us.reportKind = "early-close";
    assert.deepEqual(
      priceScoringEligibility(early, { stale: false, session: "2026-08-19" }),
      { eligible: true, reason: null },
    );
  });
});
