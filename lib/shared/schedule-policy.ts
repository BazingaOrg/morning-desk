import type { DayRunRecord } from "./run-lock";
import { BJ_TZ, wallClock } from "../time";

function beijingWeekday(now: Date): number {
  const { ymd } = wallClock(now, BJ_TZ);
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isSchedulerWeekday(now: Date): boolean {
  const dow = beijingWeekday(now);
  return dow >= 1 && dow <= 5;
}

export function isAtOrAfterBjNine(now: Date): boolean {
  const { hour } = wallClock(now, BJ_TZ);
  return hour >= 9;
}

export const MAX_FAILED_RUN_ATTEMPTS = 3;

export function shouldRetryFailedRun(now: Date, record: DayRunRecord): boolean {
  const attempts = record.attempts ?? 1;
  if (attempts >= MAX_FAILED_RUN_ATTEMPTS) return false;
  const finished = Date.parse(record.finishedAt ?? record.startedAt ?? "");
  if (!Number.isFinite(finished)) return false;
  const backoffMs = 10 * 60 * 1000 * 2 ** (attempts - 1);
  return now.getTime() - finished >= backoffMs;
}

export function shouldRunMorning(now: Date, morning: DayRunRecord | null): boolean {
  if (!isSchedulerWeekday(now)) return false;
  if (!isAtOrAfterBjNine(now)) return false;
  if (morning?.status === "failed") return shouldRetryFailedRun(now, morning);
  return morning?.status !== "success";
}
