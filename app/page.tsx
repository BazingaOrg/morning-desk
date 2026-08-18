import { ReportApp } from "@/components/ReportApp";
import { loadLatestReport } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const report = await loadLatestReport();
  return <ReportApp initialReport={report} />;
}
