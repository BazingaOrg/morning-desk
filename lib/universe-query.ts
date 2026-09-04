import { rowDisplayName } from "./calc";
import type { DailyReport, UniverseItem } from "./types";

export function reportIds(report: DailyReport | null): Set<string> {
  const ids = new Set<string>();
  if (!report) return ids;
  for (const row of report.usRows) ids.add(row.id);
  for (const row of report.hkRows) ids.add(row.id);
  return ids;
}

export function intersectReport(report: DailyReport, ids: Set<string>): DailyReport {
  return {
    ...report,
    usRows: report.usRows.filter((row) => ids.has(row.id)),
    hkRows: report.hkRows.filter((row) => ids.has(row.id)),
    movers: report.movers.filter((row) => ids.has(row.id)),
    catalysts: report.catalysts.filter((row) => ids.has(row.id)),
  };
}

function withUniverseName<T extends { id: string; name: string }>(
  row: T,
  items: Map<string, UniverseItem>,
): T {
  const item = items.get(row.id);
  if (!item || item.market !== "US") return row;
  const name = rowDisplayName(item);
  return name === row.name ? row : { ...row, name };
}

export function presentReport(report: DailyReport, items: UniverseItem[]): DailyReport {
  const byId = new Map(items.map((item) => [item.id, item]));
  const filtered = intersectReport(report, new Set(byId.keys()));
  return {
    ...filtered,
    usRows: filtered.usRows.map((row) => withUniverseName(row, byId)),
    hkRows: filtered.hkRows.map((row) => withUniverseName(row, byId)),
    movers: filtered.movers.map((row) => withUniverseName(row, byId)),
    catalysts: filtered.catalysts.map((row) => withUniverseName(row, byId)),
  };
}
