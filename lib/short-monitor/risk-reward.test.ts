import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapLevelToInverseEtf, rrFromLevels } from "./risk-reward";

describe("risk-reward", () => {
  it("rrFromLevels divides reward by risk of an invalidation geometry", () => {
    assert.equal(rrFromLevels(100, 110, 90), 1);
    assert.equal(rrFromLevels(100, 105, 80), 4);
    assert.equal(rrFromLevels(100, 110, 70), 3);
  });

  it("rrFromLevels rejects invalid geometry", () => {
    assert.equal(rrFromLevels(100, 100, 90), null);
    assert.equal(rrFromLevels(100, 90, 50), null);
    assert.equal(rrFromLevels(100, NaN, 50), null);
  });

  it("maps a short target above and a stop below the tool close", () => {
    const cases: Array<[number | null, number]> = [
      [mapLevelToInverseEtf(100, 110, 50, -2), 40],
      [mapLevelToInverseEtf(100, 90, 50, -2), 60],
      [mapLevelToInverseEtf(100, 110, 50, -1), 45],
      [mapLevelToInverseEtf(100, 90, 50, -1), 55],
    ];
    for (const [actual, expected] of cases) {
      assert.ok(actual != null && Math.abs(actual - expected) < 1e-9);
    }
  });

  it("rejects unreachable or invalid mapping inputs", () => {
    assert.equal(mapLevelToInverseEtf(100, 200, 50, -2), null);
    assert.equal(mapLevelToInverseEtf(0, 110, 50, -2), null);
    assert.equal(mapLevelToInverseEtf(100, 110, 0, -2), null);
    assert.equal(mapLevelToInverseEtf(100, 110, 50, 0), null);
    assert.equal(mapLevelToInverseEtf(100, NaN, 50, -2), null);
  });
});
