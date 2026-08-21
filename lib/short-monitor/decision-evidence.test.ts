import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveDecisionEvidence } from "./decision-evidence";
import type { AssetModelView, EvidenceItem } from "./types";

function model(evidenceIds: string[]): AssetModelView {
  return {
    consensus: "test",
    variant: "test",
    falsification: "test",
    inflection: "test",
    fundamentalShift: "HIGH",
    expectationGap: "HIGH",
    catalystStrength: "HIGH",
    evidenceConfidence: "HIGH",
    priceReactionFunction: "HIGH",
    evidenceIds,
    bullCase: "test",
    bearCase: "test",
    missingData: [],
  };
}

function item(
  id: string,
  cluster: EvidenceItem["cluster"],
  signal: EvidenceItem["signal"],
): EvidenceItem {
  return {
    id,
    asset: "MACRO",
    kind: "test",
    observedAt: "2026-08-20T01:00:00.000Z",
    sourceTier: 1,
    sourceName: "test",
    sourceUrl: "https://example.com",
    title: id,
    summary: id,
    verified: true,
    stale: false,
    cluster,
    signal,
    relevantAssets: ["NASDAQ"],
    limitations: [],
  };
}

describe("deriveDecisionEvidence", () => {
  it("does not count session calendar, catalyst, price or neutral data as drivers", () => {
    const items = [
      item("calendar", "CALENDAR", "CONTEXT"),
      item("catalyst", "CATALYST", "CONTEXT"),
      item("market", "MARKET", "BEARISH"),
      item("rates", "RATES", "NEUTRAL"),
    ];
    const result = deriveDecisionEvidence({
      asset: "NASDAQ",
      model: model(items.map((evidence) => evidence.id)),
      items,
      gaps: [],
    });
    assert.equal(result.independentDrivers, 0);
    assert.equal(result.catalystPresent, true);
  });

  it("deduplicates bearish observations from the same factor cluster", () => {
    const items = [
      item("real-yield", "RATES", "BEARISH"),
      item("nominal-yield", "RATES", "BEARISH"),
      item("earnings", "COMPANY", "BEARISH"),
    ];
    const result = deriveDecisionEvidence({
      asset: "NASDAQ",
      model: model(items.map((evidence) => evidence.id)),
      items,
      gaps: [],
    });
    assert.equal(result.independentDrivers, 2);
    assert.deepEqual(new Set(result.bearishClusters), new Set(["RATES", "COMPANY"]));
    assert.equal(result.trustedThesisEvidence, true);
  });

  it("allows real source cluster combinations to reach Nasdaq and Gold driver gates", () => {
    const rates = item("rates", "RATES", "BEARISH");
    const liquidity = item("liquidity", "LIQUIDITY", "BEARISH");
    const nasdaq = deriveDecisionEvidence({
      asset: "NASDAQ",
      model: model([rates.id, liquidity.id]),
      items: [rates, liquidity],
      gaps: [],
    });
    assert.equal(nasdaq.independentDrivers, 2);
    assert.equal(nasdaq.trustedThesisEvidence, true);

    const positioning = { ...item("positioning", "POSITIONING", "BEARISH"), relevantAssets: ["GOLD" as const] };
    const goldRates = { ...rates, relevantAssets: ["GOLD" as const] };
    const goldLiquidity = { ...liquidity, relevantAssets: ["GOLD" as const] };
    const gold = deriveDecisionEvidence({
      asset: "GOLD",
      model: model([goldRates.id, goldLiquidity.id, positioning.id]),
      items: [goldRates, goldLiquidity, positioning],
      gaps: [],
    });
    assert.equal(gold.independentDrivers, 3);
    assert.equal(gold.trustedThesisEvidence, true);
  });

  it("maps only asset-relevant blocking gaps into veto reasons", () => {
    const result = deriveDecisionEvidence({
      asset: "NASDAQ",
      model: model([]),
      items: [],
      gaps: [
        {
          source: "FRED",
          affectedAssets: ["NASDAQ", "GOLD"],
          capability: "RATES",
          blocking: true,
          message: "FRED unavailable",
        },
        {
          source: "SEC",
          affectedAssets: ["SPCX"],
          capability: "FUNDAMENTAL",
          blocking: true,
          message: "SEC unavailable",
        },
      ],
    });
    assert.deepEqual(result.blockingGaps, ["rates-gap:FRED unavailable"]);
  });
});
