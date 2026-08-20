import { ReportApp } from "@/components/ReportApp";
import {
  buildUniversePayloadFrom,
  intersectReport,
  isJobLive,
  loadJobStatus,
  loadLatestReport,
  loadUniverse,
} from "@/lib/store";
import { connection } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  await connection();
  const [report, status, items] = await Promise.all([
    loadLatestReport(),
    loadJobStatus(),
    loadUniverse(),
  ]);
  const ids = new Set(items.map((item) => item.id));
  const served = report ? intersectReport(report, ids) : null;
  const initialUniverse = buildUniversePayloadFrom(items, report);
  return (
    <ReportApp
      initialReport={served}
      initialUpdating={isJobLive(status)}
      initialUniverse={initialUniverse}
    />
  );
}
