import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveOpenLifecycle, tradingSessionsAfter } from "./open-lifecycle";

describe("open lifecycle", () => {
  it("downgrades an unconfigured OPEN position to UNKNOWN", () => {
    const result = deriveOpenLifecycle({
      position: { asset: "SPCX", status: "OPEN" },
      currentSession: "2026-08-19",
      lastClose: 90,
      priceEligible: true,
    });
    assert.equal(result.position, "UNKNOWN");
    assert.deepEqual(result.vetoes, ["open-lifecycle-unconfigured"]);
  });

  it("uses US trading sessions for TTL and time stop", () => {
    assert.equal(tradingSessionsAfter("2026-08-14", "2026-08-19"), 3);
    const base = {
      position: {
        asset: "SPCX",
        status: "OPEN" as const,
        openedSession: "2026-08-14",
        entryUnderlyingPrice: 100,
        priceInvalidation: 110,
      },
      currentSession: "2026-08-19",
      lastClose: 101,
      priceEligible: true,
    };
    assert.equal(deriveOpenLifecycle(base).ttlExpired, true);
    const timeStop = deriveOpenLifecycle({
      ...base,
      currentSession: "2026-08-28",
    });
    assert.equal(timeStop.timeStop, true);
    assert.equal(timeStop.ttlExpired, false);
  });

  it("triggers controlled thesis and aligned price stops but not stale price stops", () => {
    const configured = {
      asset: "GOLD",
      status: "OPEN" as const,
      openedSession: "2026-08-18",
      entryUnderlyingPrice: 100,
      priceInvalidation: 110,
      thesisInvalidated: true,
    };
    const live = deriveOpenLifecycle({
      position: configured,
      currentSession: "2026-08-19",
      lastClose: 111,
      priceEligible: true,
    });
    assert.equal(live.thesisStop, true);
    assert.equal(live.priceStop, true);
    const stale = deriveOpenLifecycle({
      position: configured,
      currentSession: "2026-08-19",
      lastClose: 111,
      priceEligible: false,
    });
    assert.equal(stale.thesisStop, true);
    assert.equal(stale.priceStop, false);
  });
});
