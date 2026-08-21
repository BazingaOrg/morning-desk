import type { ShortMonitorReport } from "./types";

export function focusDecisionAsset(report: ShortMonitorReport) {
  return report.decision.assets.find((row) => row.action === report.decision.action) ??
    report.decision.assets.find((row) => row.asset === report.decision.bestOpportunity) ??
    [...report.decision.assets].sort((left, right) => (right.score ?? -1) - (left.score ?? -1))[0];
}
