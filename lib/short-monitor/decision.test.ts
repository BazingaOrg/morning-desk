import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { decideAsset } from "./decision-validator";
import { rrFromLevels } from "./risk-reward";
import {
  SCORE_WEIGHTS,
  TIER_FRACTION,
  computeScore,
  stateFromScore,
} from "./score";
import type {
  AssetDecisionInput,
  AssetId,
  PositionStatus,
  TierLevel,
  ShortMonitorFixture,
} from "./types";
import { collectBlockingVetoes } from "./veto";

const FIXTURES = path.join(process.cwd(), "data", "short-monitor", "fixtures");

function loadFixture(id: string): ShortMonitorFixture {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, `${id}.json`), "utf8"),
  ) as ShortMonitorFixture;
}

function baseModel(tiers: {
  fundamentalShift?: TierLevel;
  expectationGap?: TierLevel;
  catalystStrength?: TierLevel;
  evidenceConfidence?: TierLevel;
}): AssetDecisionInput["model"] {
  return {
    fundamentalShift: tiers.fundamentalShift ?? "NONE",
    expectationGap: tiers.expectationGap ?? "NONE",
    catalystStrength: tiers.catalystStrength ?? "NONE",
    evidenceConfidence: tiers.evidenceConfidence ?? "NONE",
    evidenceIds: [],
  };
}

function input(
  partial: Partial<AssetDecisionInput> & {
    asset?: AssetId;
    position?: PositionStatus;
  },
): AssetDecisionInput {
  return {
    asset: partial.asset ?? "SPCX",
    model: partial.model ?? baseModel({}),
    priceConfirmation: partial.priceConfirmation ?? false,
    independentDrivers: partial.independentDrivers ?? 0,
    rr: partial.rr ?? null,
    blockingVetoes: partial.blockingVetoes ?? [],
    thesisEntry: partial.thesisEntry ?? false,
    priceEntry: partial.priceEntry ?? false,
    catalystEntry: partial.catalystEntry ?? false,
    position: partial.position ?? "FLAT",
    thesisStop: partial.thesisStop,
    timeStop: partial.timeStop,
    ttlExpired: partial.ttlExpired,
  };
}

describe("score mapping", () => {
  it("maps tiers to fractions and weights", () => {
    assert.equal(TIER_FRACTION.NONE, 0);
    assert.equal(TIER_FRACTION.LOW, 0.25);
    assert.equal(TIER_FRACTION.MEDIUM, 0.5);
    assert.equal(TIER_FRACTION.HIGH, 0.75);
    assert.equal(TIER_FRACTION.VERY_HIGH, 1);
    assert.equal(SCORE_WEIGHTS.fundamentalShift, 30);
    assert.equal(SCORE_WEIGHTS.expectationGap, 15);
    assert.equal(SCORE_WEIGHTS.industryMacro, 20);
    assert.equal(SCORE_WEIGHTS.marketConfirmation, 25);
    assert.equal(SCORE_WEIGHTS.catalyst, 10);
  });

  it("state bands follow score thresholds", () => {
    assert.equal(stateFromScore(0), "WATCH");
    assert.equal(stateFromScore(49), "WATCH");
    assert.equal(stateFromScore(50), "ARMED");
    assert.equal(stateFromScore(69), "ARMED");
    assert.equal(stateFromScore(70), "CONFIRMING");
    assert.equal(stateFromScore(79), "CONFIRMING");
    assert.equal(stateFromScore(80), "TRIGGERED");
    assert.equal(stateFromScore(100), "TRIGGERED");
  });

  it("applies valuation-only cap at 40", () => {
    const score = computeScore({
      asset: "SPCX",
      fundamentalShift: "LOW",
      expectationGap: "VERY_HIGH",
      catalystStrength: "HIGH",
      priceConfirmation: false,
      independentDrivers: 3,
    });
    assert.ok(score <= 40);
  });

  it("caps Nasdaq below ARMED without drivers or price", () => {
    const score = computeScore({
      asset: "NASDAQ",
      fundamentalShift: "HIGH",
      expectationGap: "HIGH",
      catalystStrength: "HIGH",
      priceConfirmation: false,
      independentDrivers: 3,
    });
    assert.ok(score <= 49);
  });

  it("caps Gold at 69 without three drivers", () => {
    const score = computeScore({
      asset: "GOLD",
      fundamentalShift: "VERY_HIGH",
      expectationGap: "VERY_HIGH",
      catalystStrength: "VERY_HIGH",
      priceConfirmation: true,
      independentDrivers: 2,
    });
    assert.ok(score <= 69);
  });
});

describe("rrFromLevels", () => {
  it("computes short R/R when stop > entry > target", () => {
    assert.equal(rrFromLevels(100, 110, 70), 3);
    assert.equal(rrFromLevels(100, 105, 90), 2);
  });

  it("returns null for invalid short geometry", () => {
    assert.equal(rrFromLevels(100, 90, 70), null);
    assert.equal(rrFromLevels(100, 110, 110), null);
    assert.equal(rrFromLevels(100, 110, 120), null);
  });
});

describe("collectBlockingVetoes", () => {
  it("collects flagged veto reasons", () => {
    assert.deepEqual(
      collectBlockingVetoes({
        dataConflict: true,
        staleData: true,
        rrMissingOrBelowMin: true,
      }),
      ["data-conflict", "stale-data", "rr-missing-or-below-min"],
    );
  });
});

describe("decideAsset fixtures", () => {
  it("01-all-wait: four assets NONE tiers, no price, FLAT → WAIT WATCH", () => {
    const fixture = loadFixture("01-all-wait");
    assert.equal(fixture.position, "FLAT");
    const assets: AssetId[] = ["SPCX", "SNDK", "NASDAQ", "GOLD"];
    for (const asset of assets) {
      const result = decideAsset(
        input({
          asset,
          position: fixture.position,
          model: baseModel({}),
          priceConfirmation: false,
          independentDrivers: 0,
        }),
      );
      assert.equal(result.state, "WATCH");
      assert.equal(result.action, "WAIT");
      assert.ok(result.score <= 49);
      assert.equal(result.entryIsCandidate, undefined);
    }
  });

  it("04-headline-no-price: HIGH catalyst MEDIUM fundamental no price → not TRIGGERED/ENTER", () => {
    const fixture = loadFixture("04-headline-no-price");
    const result = decideAsset(
      input({
        asset: "SPCX",
        position: fixture.position,
        model: baseModel({
          fundamentalShift: "MEDIUM",
          expectationGap: "MEDIUM",
          catalystStrength: "HIGH",
        }),
        priceConfirmation: false,
        independentDrivers: 2,
        rr: 2.5,
        thesisEntry: true,
        priceEntry: false,
        catalystEntry: true,
      }),
    );
    assert.notEqual(result.state, "TRIGGERED");
    assert.notEqual(result.action, "ENTER");
    assert.ok(result.action === "WAIT" || result.action === "PREPARE");
  });

  it("05-score-with-veto: high tiers + price + rr but data-conflict → not TRIGGERED", () => {
    const fixture = loadFixture("05-score-with-veto");
    const result = decideAsset(
      input({
        asset: "SPCX",
        position: fixture.position,
        model: baseModel({
          fundamentalShift: "HIGH",
          expectationGap: "HIGH",
          catalystStrength: "HIGH",
        }),
        priceConfirmation: true,
        independentDrivers: 3,
        rr: 3,
        blockingVetoes: ["data-conflict"],
        thesisEntry: true,
        priceEntry: true,
        catalystEntry: true,
      }),
    );
    assert.ok(result.score >= 50);
    assert.notEqual(result.state, "TRIGGERED");
    assert.notEqual(result.action, "ENTER");
    assert.ok(result.action === "WAIT" || result.action === "PREPARE");
    assert.ok(result.reasons.some((r) => r.includes("data-conflict")));
  });

  it("06-full-trigger: all gates → TRIGGERED ENTER entryIsCandidate", () => {
    const fixture = loadFixture("06-full-trigger");
    const result = decideAsset(
      input({
        asset: "SPCX",
        position: fixture.position,
        model: baseModel({
          fundamentalShift: "HIGH",
          expectationGap: "HIGH",
          catalystStrength: "HIGH",
        }),
        priceConfirmation: true,
        independentDrivers: 3,
        rr: 2.5,
        thesisEntry: true,
        priceEntry: true,
        catalystEntry: true,
      }),
    );
    assert.equal(result.state, "TRIGGERED");
    assert.equal(result.action, "ENTER");
    assert.equal(result.entryIsCandidate, true);
    assert.ok(result.score >= 80);
  });

  it("07-flat-rejects-reduce: FLAT never REDUCE/HOLD/EXIT", () => {
    const fixture = loadFixture("07-flat-rejects-reduce");
    assert.equal(fixture.position, "FLAT");
    const cases: AssetDecisionInput[] = [
      input({ position: "FLAT", model: baseModel({}) }),
      input({
        position: "FLAT",
        model: baseModel({
          fundamentalShift: "HIGH",
          expectationGap: "HIGH",
          catalystStrength: "HIGH",
        }),
        priceConfirmation: true,
        independentDrivers: 3,
        rr: 2.5,
        thesisEntry: true,
        priceEntry: true,
        catalystEntry: true,
      }),
      input({
        position: "FLAT",
        model: baseModel({
          fundamentalShift: "MEDIUM",
          expectationGap: "MEDIUM",
          catalystStrength: "MEDIUM",
        }),
        priceConfirmation: true,
        independentDrivers: 2,
        rr: 2,
      }),
    ];
    for (const c of cases) {
      const result = decideAsset(c);
      assert.ok(
        result.action === "WAIT" ||
          result.action === "PREPARE" ||
          result.action === "ENTER",
      );
      assert.notEqual(result.action, "REDUCE");
      assert.notEqual(result.action, "HOLD");
      assert.notEqual(result.action, "EXIT");
    }
  });

  it("OPEN maps thesis/time stop to EXIT, TTL to REDUCE, else HOLD/WAIT", () => {
    const openBase = {
      position: "OPEN" as const,
      model: baseModel({
        fundamentalShift: "HIGH",
        expectationGap: "HIGH",
        catalystStrength: "HIGH",
      }),
      priceConfirmation: true,
      independentDrivers: 3,
      rr: 2.5,
    };
    const hold = decideAsset(input(openBase));
    assert.equal(hold.action, "HOLD");
    assert.notEqual(hold.action, "ENTER");

    const reduce = decideAsset(input({ ...openBase, ttlExpired: true }));
    assert.equal(reduce.action, "REDUCE");
    assert.ok(reduce.reasons.includes("signal-ttl-expired"));

    const exitThesis = decideAsset(input({ ...openBase, thesisStop: true }));
    assert.equal(exitThesis.action, "EXIT");
    assert.ok(exitThesis.reasons.includes("thesis-stop"));

    const exitTime = decideAsset(input({ ...openBase, timeStop: true }));
    assert.equal(exitTime.action, "EXIT");
    assert.ok(exitTime.reasons.includes("time-stop"));

    const wait = decideAsset(input({ position: "OPEN", model: baseModel({}) }));
    assert.equal(wait.action, "WAIT");
  });

  it("UNKNOWN never ENTER", () => {
    const high = decideAsset(
      input({
        position: "UNKNOWN",
        model: baseModel({
          fundamentalShift: "HIGH",
          expectationGap: "HIGH",
          catalystStrength: "HIGH",
        }),
        priceConfirmation: true,
        independentDrivers: 3,
        rr: 2.5,
        thesisEntry: true,
        priceEntry: true,
        catalystEntry: true,
      }),
    );
    assert.notEqual(high.action, "ENTER");
    assert.ok(high.action === "WAIT" || high.action === "PREPARE");
    assert.notEqual(high.action, "HOLD");
    assert.notEqual(high.action, "REDUCE");
    assert.notEqual(high.action, "EXIT");

    const low = decideAsset(
      input({
        position: "UNKNOWN",
        model: baseModel({}),
      }),
    );
    assert.equal(low.action, "WAIT");
  });
});
