import { ShortMonitor } from "@/components/ShortMonitor";
import {
  loadCurrentShortMonitorReport,
  loadShortMonitorReport,
} from "@/lib/short-monitor/run-store";
import { readDayRun } from "@/lib/shared/run-lock";
import { beijingDate } from "@/lib/time";
import { connection } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ShortMonitorPage() {
  await connection();
  const bj = beijingDate();
  const [morning, short, latest] = await Promise.all([
    readDayRun("morning", bj),
    readDayRun("short-monitor", bj),
    loadShortMonitorReport(),
  ]);
  const report = await loadCurrentShortMonitorReport({
    beijingDate: bj,
    morningSnapshotId: morning?.marketSnapshotId ?? null,
    dayRun: short,
  });
  return (
    <ShortMonitor
      report={report}
      morningStatus={morning?.status ?? null}
      shortStatus={short?.status ?? null}
      lastPublishedAt={!report ? latest?.generatedAt ?? null : null}
    />
  );
}
