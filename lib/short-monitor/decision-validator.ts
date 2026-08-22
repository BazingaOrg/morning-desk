import {
  computeScore,
  isMediumOrAbove,
  stateFromScore,
} from "./score";
import type {
  Action,
  AssetDecideResult,
  AssetDecisionInput,
  MonitorState,
} from "./types";

function triggeredGates(input: AssetDecisionInput, reasons: string[]): boolean {
  let ok = true;
  if (!isMediumOrAbove(input.model.expectationGap)) {
    reasons.push("expectation-gap-below-medium");
    ok = false;
  }
  if (!isMediumOrAbove(input.model.fundamentalShift)) {
    reasons.push("fundamental-shift-below-medium");
    ok = false;
  }
  if (!input.priceConfirmation) {
    reasons.push("price-confirmation-missing");
    ok = false;
  }
  if (!input.catalystEntry) {
    reasons.push("catalyst-below-medium");
    ok = false;
  }
  if (input.rr === null || !(input.rr >= 2)) {
    reasons.push("rr-below-min-or-missing");
    ok = false;
  }
  if (input.blockingVetoes.length > 0) {
    for (const v of input.blockingVetoes) {
      reasons.push(`veto:${v}`);
    }
    ok = false;
  }
  return ok;
}

function enterGates(input: AssetDecisionInput, reasons: string[]): boolean {
  let ok = true;
  if (!input.thesisEntry) {
    reasons.push("thesis-entry-missing");
    ok = false;
  }
  if (!input.priceEntry) {
    reasons.push("price-entry-missing");
    ok = false;
  }
  if (!input.catalystEntry) {
    reasons.push("catalyst-entry-missing");
    ok = false;
  }
  if (input.position !== "FLAT") {
    reasons.push("position-not-flat");
    ok = false;
  }
  return ok;
}

function actionForFlat(
  state: MonitorState,
  canEnter: boolean,
): Action {
  if (canEnter && state === "TRIGGERED") return "ENTER";
  if (state === "ARMED" || state === "CONFIRMING" || state === "TRIGGERED") {
    return "PREPARE";
  }
  return "WAIT";
}

function actionForOpen(
  input: AssetDecisionInput,
  score: number,
  reasons: string[],
): Action {
  if (input.thesisStop) {
    reasons.push("thesis-stop");
    return "EXIT";
  }
  if (input.priceStop) {
    reasons.push("price-stop");
    return "EXIT";
  }
  if (input.timeStop) {
    reasons.push("time-stop");
    return "EXIT";
  }
  if (input.reResearch) {
    reasons.push("signal-re-research-required");
    return "WAIT";
  }
  if (input.blockingVetoes.length > 0) {
    reasons.push("open-manual-review-required");
    return "WAIT";
  }
  if (input.ttlExpired) {
    reasons.push("signal-ttl-expired");
    return "REDUCE";
  }
  return score >= 50 ? "HOLD" : "WAIT";
}

function actionForUnknown(score: number): Action {
  return score >= 50 ? "PREPARE" : "WAIT";
}

export function decideAsset(input: AssetDecisionInput): AssetDecideResult {
  const reasons: string[] = [];
  const score = computeScore({
    asset: input.asset,
    fundamentalShift: input.model.fundamentalShift,
    expectationGap: input.model.expectationGap,
    catalystStrength: input.model.catalystStrength,
    priceConfirmation: input.priceConfirmation,
    independentDrivers: input.independentDrivers,
    volumeRatio: input.volumeRatio,
    sessionKind: input.sessionKind,
  });

  let state = stateFromScore(score);
  if (state === "TRIGGERED") {
    const gatesOk = triggeredGates(input, reasons);
    if (!gatesOk) {
      state = "CONFIRMING";
      reasons.push("triggered-gates-failed");
    }
  } else if (input.blockingVetoes.length > 0) {
    for (const v of input.blockingVetoes) {
      reasons.push(`veto:${v}`);
    }
  }

  let action: Action;
  let entryIsCandidate: boolean | undefined;

  if (input.position === "FLAT") {
    const canEnter =
      state === "TRIGGERED" && enterGates(input, reasons);
    action = actionForFlat(state, canEnter);
    if (action === "ENTER") {
      entryIsCandidate = true;
    }
  } else if (input.position === "OPEN") {
    action = actionForOpen(input, score, reasons);
    if (state === "TRIGGERED") {
      reasons.push("open-never-enter");
    }
  } else {
    action = actionForUnknown(score);
    reasons.push("position-unknown");
  }

  const result: AssetDecideResult = { score, state, action, reasons };
  if (entryIsCandidate) result.entryIsCandidate = true;
  return result;
}
