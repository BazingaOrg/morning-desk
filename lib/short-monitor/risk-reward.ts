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

export function mapLevelToInverseEtf(
  underlyingClose: number,
  level: number,
  toolClose: number,
  leverage: number,
): number | null {
  if (
    !Number.isFinite(underlyingClose) ||
    !Number.isFinite(level) ||
    !Number.isFinite(toolClose) ||
    !Number.isFinite(leverage) ||
    underlyingClose <= 0 ||
    toolClose <= 0 ||
    leverage === 0
  ) {
    return null;
  }
  const underlyingReturn = level / underlyingClose - 1;
  const mapped = toolClose * (1 - Math.abs(leverage) * underlyingReturn);
  return mapped > 0 ? mapped : null;
}
