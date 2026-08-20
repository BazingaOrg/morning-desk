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

export function shouldRunMorning(now: Date, morning: DayRunRecord | null): boolean {
  if (!isSchedulerWeekday(now)) return false;
  if (!isAtOrAfterBjNine(now)) return false;
  return morning?.status !== "success";
}

export function shouldRunShort(
  now: Date,
  morning: DayRunRecord | null,
  short: DayRunRecord | null,
): boolean {
  if (!isSchedulerWeekday(now)) return false;
  if (!isAtOrAfterBjNine(now)) return false;
  if (morning?.status !== "success") return false;
  return short === null;
}
