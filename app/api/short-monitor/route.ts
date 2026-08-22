import { loadCurrentShortMonitorReport } from "@/lib/short-monitor/run-store";
import { lastSuccessfulDayRun, readDayRun } from "@/lib/shared/run-lock";
import { beijingDate } from "@/lib/time";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const bj = beijingDate();
  const [morning, short, lastSuccess] = await Promise.all([
    readDayRun("morning", bj),
    readDayRun("short-monitor", bj),
    lastSuccessfulDayRun("short-monitor"),
  ]);
  const report = await loadCurrentShortMonitorReport({
    beijingDate: bj,
    morningSnapshotId: morning?.marketSnapshotId ?? null,
    dayRun: short,
  });
  return NextResponse.json({
    report,
    status: short?.status ?? null,
    error: short?.error ?? null,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
  });
}
