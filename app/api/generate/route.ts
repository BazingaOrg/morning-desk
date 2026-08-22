import { allowEdit } from "@/lib/desk-auth";
import { startGenerateIfIdle } from "@/lib/generate-job";
import { readDayRun } from "@/lib/shared/run-lock";
import { beijingDate } from "@/lib/time";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  if (!allowEdit(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const existing = await readDayRun("morning", beijingDate());
  if (existing?.status === "success") {
    return NextResponse.json({ started: false, skipped: true }, { status: 409 });
  }

  const started = await startGenerateIfIdle((work) => {
    after(work);
  });

  if (!started) {
    return NextResponse.json({ started: false, live: true }, { status: 409 });
  }

  return NextResponse.json({ started: true }, { status: 202 });
}
