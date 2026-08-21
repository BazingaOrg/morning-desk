import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { focusDecisionAsset } from "./presentation";
import type { AssetDecision, ShortMonitorReport } from "./types";

function asset(assetId: AssetDecision["asset"], action: AssetDecision["action"]): AssetDecision {
  return {
    asset: assetId,
    state: "TRIGGERED",
    score: 90,
    action,
    vetoes: [],
    rr: 3,
    priceConfirmation: "HIGH",
    trigger: "trigger",
    executionTool: assetId === "GOLD" ? "GLL" : "QID",
    stop: "110",
    exit: "80",
    reason: "test",
  };
}

describe("short monitor decision-card focus", () => {
  it("focuses the asset producing the global risk action before a separate entry opportunity", () => {
    const exit = asset("GOLD", "EXIT");
    const enter = asset("NASDAQ", "ENTER");
    const report = {
      decision: {
        action: "EXIT",
        bestOpportunity: "NASDAQ",
        assets: [enter, exit],
      },
    } as ShortMonitorReport;
    assert.equal(focusDecisionAsset(report)?.asset, "GOLD");
  });
});
