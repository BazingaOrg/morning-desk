import { allowEdit } from "@/lib/desk-auth";
import { startShortMonitorIfIdle } from "@/lib/short-monitor/job";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  if (!allowEdit(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = await startShortMonitorIfIdle((work) => {
    after(work);
  });
  if (status !== "started") {
    return NextResponse.json({ started: false, status }, { status: 409 });
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
