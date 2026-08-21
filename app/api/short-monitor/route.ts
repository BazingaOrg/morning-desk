import { loadCurrentShortMonitorReport } from "@/lib/short-monitor/run-store";
import { readDayRun } from "@/lib/shared/run-lock";
import { beijingDate } from "@/lib/time";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const bj = beijingDate();
  const [morning, short] = await Promise.all([
    readDayRun("morning", bj),
    readDayRun("short-monitor", bj),
  ]);
  const report = await loadCurrentShortMonitorReport({
    beijingDate: bj,
    morningSnapshotId: morning?.marketSnapshotId ?? null,
    dayRun: short,
  });
  return NextResponse.json({ report, status: short?.status ?? null });
}
