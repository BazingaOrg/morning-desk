import { loadLatestReport } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await loadLatestReport();
  return NextResponse.json({ report });
}
