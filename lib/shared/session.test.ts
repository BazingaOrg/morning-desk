import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextSessionWaterline } from "./session";

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
