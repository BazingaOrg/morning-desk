export function rrFromLevels(
  entry: number,
  stop: number,
  target: number,
): number | null {
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(stop) ||
    !Number.isFinite(target)
  ) {
    return null;
  }
  if (!(stop > entry && entry > target)) return null;
  const risk = stop - entry;
  if (risk <= 0) return null;
  return (entry - target) / risk;
}
