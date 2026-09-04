import { loadLatestReport, loadUniverse, presentReport } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [report, items] = await Promise.all([loadLatestReport(), loadUniverse()]);
  if (!report) return NextResponse.json({ report: null });
  return NextResponse.json({ report: presentReport(report, items) });
}
