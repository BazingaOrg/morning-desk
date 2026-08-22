import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agreedReferenceSession } from "./report";
import type { SeriesBundle } from "./types";
import { US_TZ } from "./time";

function bundleWithDates(dates: string[]): SeriesBundle {
  return {
    item: {
      id: "X",
      display: "X",
      name: "X",
      yahoo: "X",
      market: "US",
      benchmark: "",
      group: "",
      notes: [],
      identity: [],
    },
    quote: { yahoo: "X", symbol: "X" },
    bars: dates.map((date) => ({
      date,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      adjClose: 1,
      volume: 1,
    })),
    splits: [],
    dividends: [],
    adjustmentMode: "unadjusted" as const,
  };
}

describe("agreedReferenceSession", () => {
  it("returns the session when both references agree", () => {
    assert.equal(
      agreedReferenceSession(
        bundleWithDates(["2026-03-02", "2026-03-03"]),
        bundleWithDates(["2026-03-01", "2026-03-03"]),
        US_TZ,
      ),
      "2026-03-03",
    );
  });

  it("returns null on a reference conflict instead of trusting one source", () => {
    assert.equal(
      agreedReferenceSession(
        bundleWithDates(["2026-03-03"]),
        bundleWithDates(["2026-03-02"]),
        US_TZ,
      ),
      null,
    );
  });

  it("falls back to the single available reference", () => {
    assert.equal(
      agreedReferenceSession(bundleWithDates(["2026-03-03"]), undefined, US_TZ),
      "2026-03-03",
    );
    assert.equal(
      agreedReferenceSession(undefined, bundleWithDates(["2026-03-02"]), US_TZ),
      "2026-03-02",
    );
    assert.equal(agreedReferenceSession(undefined, undefined, US_TZ), null);
    assert.equal(agreedReferenceSession(bundleWithDates([]), bundleWithDates(["2026-03-02"]), US_TZ), "2026-03-02");
  });
});
