import { ReportApp } from "@/components/ReportApp";
import { isJobLive, loadJobStatus, loadLatestReport } from "@/lib/store";
import { connection } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  await connection();
  const [report, status] = await Promise.all([loadLatestReport(), loadJobStatus()]);
  return <ReportApp initialReport={report} initialUpdating={isJobLive(status)} />;
}
