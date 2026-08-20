export function sma(
  values: Array<number | null | undefined>,
  period: number,
): number | null {
  if (period <= 0 || values.length < period) return null;
  const window = values.slice(-period);
  if (window.some((v) => v == null || !Number.isFinite(v))) return null;
  const sum = window.reduce<number>((acc, v) => acc + (v as number), 0);
  return sum / period;
}

export function atr(
  bars: Array<{ high: number | null; low: number | null; close: number | null }>,
  period = 14,
): number | null {
  if (period <= 0 || bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (
      cur.high == null ||
      cur.low == null ||
      cur.close == null ||
      prev.close == null
    ) {
      return null;
    }
    const range = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(range);
  }
  return sma(trs, period);
}
