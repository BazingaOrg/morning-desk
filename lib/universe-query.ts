import type { DailyReport } from "./types";

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
