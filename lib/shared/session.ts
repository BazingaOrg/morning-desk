import type { UsSessionKind } from "./calendar";

export type SessionFreshness =
  | "new"
  | "unchanged"
  | "closed"
  | "early-close"
  | "stale"
  | "unavailable";

export function classifyUsFreshness(input: {
  reportKind: UsSessionKind;
  expectedCompleteSession: string | null;
  barSession: string | null;
  lastSuccessSession: string | null | undefined;
  usedStaleCache: boolean;
  completeKind?: UsSessionKind;
}): SessionFreshness {
  if (input.reportKind === "closed") return "closed";
  if (!input.barSession) return "unavailable";
  if (input.usedStaleCache) return "stale";
  if (input.barSession !== input.expectedCompleteSession) {
    if (!input.expectedCompleteSession) return "unavailable";
    return "stale";
  }
  if (input.barSession === input.lastSuccessSession) return "unchanged";
  if (input.completeKind === "early-close" || input.reportKind === "early-close") {
    return "early-close";
  }
  return "new";
}

export function nextSessionWaterline(
  previous: string | null | undefined,
  session: string | null,
  freshness: SessionFreshness,
): string | null {
  const prev = previous ?? null;
  if (freshness !== "new" && freshness !== "early-close") return prev;
  if (!session) return prev;
  if (prev && session < prev) return prev;
  return session;
}
