export type SessionFreshness =
  | "new"
  | "unchanged"
  | "closed"
  | "early-close"
  | "stale"
  | "unavailable";

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
