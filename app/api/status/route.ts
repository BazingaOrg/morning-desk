import { isJobLive, loadJobStatus } from "@/lib/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await loadJobStatus();
  return NextResponse.json({
    ...status,
    live: isJobLive(status),
  });
}
