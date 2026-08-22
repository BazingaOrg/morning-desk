import { ShortMonitor } from "@/components/ShortMonitor";
import {
  loadCurrentShortMonitorReport,
  loadShortMonitorReport,
} from "@/lib/short-monitor/run-store";
import { lastSuccessfulDayRun, readDayRun } from "@/lib/shared/run-lock";
import { beijingDate } from "@/lib/time";
import { connection } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ShortMonitorPage() {
  await connection();
  const bj = beijingDate();
  const [morning, short, latest, lastSuccess] = await Promise.all([
    readDayRun("morning", bj),
    readDayRun("short-monitor", bj),
    loadShortMonitorReport(),
    lastSuccessfulDayRun("short-monitor"),
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
      error={short?.error ?? null}
      lastPublishedAt={!report ? latest?.generatedAt ?? null : null}
      lastSuccessAt={!report ? lastSuccess?.finishedAt ?? null : null}
    />
  );
}
