import { ReportApp } from "@/components/ReportApp";
import { isJobLive, loadJobStatus, loadLatestReport } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [report, status] = await Promise.all([loadLatestReport(), loadJobStatus()]);
  return <ReportApp initialReport={report} initialUpdating={isJobLive(status)} />;
}
