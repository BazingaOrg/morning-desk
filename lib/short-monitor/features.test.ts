import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atr, sma, volumeRatio } from "./features";

function bars(closes: number[], volumes: number[]): Array<{ date: string; close: number; volume: number }> {
  return closes.map((close, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    close,
    volume: volumes[index],
  }));
}

describe("features", () => {
  it("sma returns null below the period and the average otherwise", () => {
    assert.equal(sma([1, 2, 3], 4), null);
    assert.equal(sma([1, 2, 3], 3), 2);
    assert.equal(sma([1, 2, 3], 2), 2.5);
    assert.equal(sma([1, null, 3], 3), null);
  });

  it("atr returns null without enough bars for the smoothing window", () => {
    assert.equal(atr([{ high: 1, low: 0, close: 0 }], 14), null);
    assert.ok(atr(bars(Array.from({ length: 30 }, () => 10), []).map((b) => ({ high: b.close + 1, low: b.close - 1, close: b.close })), 14) !== null);
  });

  it("volumeRatio is last volume over the prior 20-day average", () => {
    const series = bars(Array.from({ length: 21 }, () => 100), [...Array.from({ length: 20 }, () => 50), 100]);
    assert.ok(Math.abs((volumeRatio(series, "2026-08-21") ?? 0) - 2) < 1e-9);
    assert.equal(volumeRatio(series, "2026-08-20"), null);
  });

  it("volumeRatio needs at least 21 bars and a matching last date", () => {
    const short = bars([100, 100, 100], [1, 1, 1]);
    assert.equal(volumeRatio(short, "2026-08-03"), null);
    const series = bars(Array.from({ length: 21 }, () => 100), Array.from({ length: 21 }, () => 50));
    assert.ok(Math.abs((volumeRatio(series, "2026-08-21") ?? 0) - 1) < 1e-9);
  });
});
