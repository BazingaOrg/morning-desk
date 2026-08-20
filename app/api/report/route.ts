import { intersectReport, loadLatestReport, loadUniverse } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [report, items] = await Promise.all([loadLatestReport(), loadUniverse()]);
  if (!report) return NextResponse.json({ report: null });
  const ids = new Set(items.map((item) => item.id));
  return NextResponse.json({ report: intersectReport(report, ids) });
}
