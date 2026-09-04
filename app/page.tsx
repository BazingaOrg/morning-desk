import { ReportApp } from "@/components/ReportApp";
import {
  buildUniversePayloadFrom,
  isJobLive,
  loadJobStatus,
  loadLatestReport,
  loadUniverse,
  presentReport,
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
  const served = report ? presentReport(report, items) : null;
  const initialUniverse = buildUniversePayloadFrom(items, report);
  return (
    <ReportApp
      initialReport={served}
      initialUpdating={isJobLive(status)}
      initialUniverse={initialUniverse}
    />
  );
}
