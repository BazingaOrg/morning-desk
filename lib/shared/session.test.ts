import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyUsFreshness, nextSessionWaterline } from "./session";

describe("classifyUsFreshness", () => {
  it("classifies closed, unavailable, and stale sessions", () => {
    assert.equal(classifyUsFreshness({
      reportKind: "closed",
      expectedCompleteSession: "2025-12-31",
      barSession: "2025-12-31",
      lastSuccessSession: "2025-12-31",
      usedStaleCache: false,
    }), "closed");
    assert.equal(classifyUsFreshness({
      reportKind: "open",
      expectedCompleteSession: "2026-01-05",
      barSession: null,
      lastSuccessSession: null,
      usedStaleCache: false,
    }), "unavailable");
    assert.equal(classifyUsFreshness({
      reportKind: "open",
      expectedCompleteSession: "2026-01-05",
      barSession: "2026-01-02",
      lastSuccessSession: "2026-01-02",
      usedStaleCache: false,
    }), "stale");
  });

  it("classifies unchanged, new, and early-close sessions", () => {
    const base = {
      expectedCompleteSession: "2026-01-05",
      barSession: "2026-01-05",
      usedStaleCache: false,
    };
    assert.equal(classifyUsFreshness({
      ...base,
      reportKind: "open",
      lastSuccessSession: "2026-01-05",
    }), "unchanged");
    assert.equal(classifyUsFreshness({
      ...base,
      reportKind: "open",
      lastSuccessSession: "2026-01-02",
    }), "new");
    assert.equal(classifyUsFreshness({
      ...base,
      reportKind: "early-close",
      completeKind: "early-close",
      lastSuccessSession: "2026-01-02",
    }), "early-close");
  });
});

describe("nextSessionWaterline", () => {
  it("advances only on new or early-close", () => {
    assert.equal(nextSessionWaterline("2026-01-02", "2026-01-05", "new"), "2026-01-05");
    assert.equal(nextSessionWaterline("2026-01-02", "2026-01-05", "early-close"), "2026-01-05");
  });

  it("keeps previous on unchanged closed stale unavailable", () => {
    assert.equal(nextSessionWaterline("2026-01-05", "2026-01-05", "unchanged"), "2026-01-05");
    assert.equal(nextSessionWaterline("2026-01-05", "2025-12-31", "closed"), "2026-01-05");
    assert.equal(nextSessionWaterline("2026-01-05", "2026-01-02", "stale"), "2026-01-05");
    assert.equal(nextSessionWaterline("2026-01-05", null, "unavailable"), "2026-01-05");
  });

  it("never moves the waterline backwards", () => {
    assert.equal(nextSessionWaterline("2026-01-08", "2026-01-05", "new"), "2026-01-08");
  });
});
