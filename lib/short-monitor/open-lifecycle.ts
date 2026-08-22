import { usSessionKind } from "../shared/calendar";
import { addCalendarDays } from "../time";
import type { Position } from "./master";
import type { PositionStatus } from "./types";

function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function tradingSessionsAfter(openedSession: string, currentSession: string): number {
  if (openedSession >= currentSession) return 0;
  let count = 0;
  let cursor = addCalendarDays(openedSession, 1);
  for (let i = 0; i < 4000 && cursor <= currentSession; i += 1) {
    if (usSessionKind(cursor) !== "closed") count += 1;
    cursor = addCalendarDays(cursor, 1);
  }
  return count;
}

export function deriveOpenLifecycle(input: {
  position: Position | undefined;
  currentSession: string | null;
  lastClose: number | null;
  priceEligible: boolean;
}): {
  position: PositionStatus;
  vetoes: string[];
  thesisStop: boolean;
  priceStop: boolean;
  ttlExpired: boolean;
  reResearch: boolean;
  heldSessions: number | null;
} {
  const position = input.position;
  if (!position) {
    return {
      position: "UNKNOWN",
      vetoes: ["position-missing"],
      thesisStop: false,
      priceStop: false,
      ttlExpired: false,
      reResearch: false,
      heldSessions: null,
    };
  }
  if (position.status !== "OPEN") {
    return {
      position: position.status,
      vetoes: [],
      thesisStop: false,
      priceStop: false,
      ttlExpired: false,
      reResearch: false,
      heldSessions: null,
    };
  }
  if (
    !isYmd(position.openedSession) ||
    !positive(position.entryUnderlyingPrice) ||
    !positive(position.priceInvalidation) ||
    position.priceInvalidation <= position.entryUnderlyingPrice ||
    usSessionKind(position.openedSession) === "closed" ||
    !input.currentSession ||
    position.openedSession > input.currentSession
  ) {
    return {
      position: "UNKNOWN",
      vetoes: ["open-lifecycle-unconfigured"],
      thesisStop: false,
      priceStop: false,
      ttlExpired: false,
      reResearch: false,
      heldSessions: null,
    };
  }

  const heldSessions = tradingSessionsAfter(position.openedSession, input.currentSession);
  const canUsePrice = input.priceEligible && input.lastClose != null;
  const noFollowThrough = canUsePrice && input.lastClose! >= position.entryUnderlyingPrice;
  return {
    position: "OPEN",
    vetoes: [],
    thesisStop: position.thesisInvalidated === true,
    priceStop: canUsePrice && input.lastClose! >= position.priceInvalidation,
    ttlExpired: noFollowThrough && heldSessions >= 3 && heldSessions < 10,
    reResearch: noFollowThrough && heldSessions >= 10,
    heldSessions,
  };
}
