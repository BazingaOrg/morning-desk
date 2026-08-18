export const BJ_TZ = "Asia/Shanghai";
export const US_TZ = "America/New_York";
export const HK_TZ = "Asia/Hong_Kong";

export function nowUtc(): Date {
  return new Date();
}

export function ymdInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function beijingDate(date = nowUtc()): string {
  return ymdInZone(date, BJ_TZ);
}

export function formatBeijingLong(date = nowUtc()): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BJ_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatBeijingStamp(date = nowUtc()): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BJ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function sessionDateFromBar(barDate: Date, exchangeTz: string): string {
  const utcHours = barDate.getUTCHours();
  if (utcHours <= 6) {
    return barDate.toISOString().slice(0, 10);
  }
  return ymdInZone(barDate, exchangeTz);
}

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86_400_000);
}

export function inNextDays(ymd: string, from: string, days: number): boolean {
  const delta = daysBetween(from, ymd);
  return delta >= 0 && delta <= days;
}
