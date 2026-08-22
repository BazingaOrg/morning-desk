import calendarData from "../../data/shared/us-market-calendar.json";
import {
  US_TZ,
  addCalendarDays,
  regularSessionClosed,
  wallClock,
} from "../time";

export type UsSessionKind = "open" | "early-close" | "closed";

type CalendarPayload = {
  holidays: string[];
  earlyCloses: string[];
};

let cached: { holidays: Set<string>; earlyCloses: Set<string> } | null = null;

export function loadUsCalendar(): {
  holidays: Set<string>;
  earlyCloses: Set<string>;
} {
  if (cached) return cached;
  const data = calendarData as CalendarPayload;
  cached = {
    holidays: new Set(data.holidays),
    earlyCloses: new Set(data.earlyCloses),
  };
  return cached;
}

export function usCalendarCoverageEnd(): string | null {
  const { holidays, earlyCloses } = loadUsCalendar();
  let end: string | null = null;
  for (const ymd of [...holidays, ...earlyCloses]) {
    if (!end || ymd > end) end = ymd;
  }
  return end;
}

function weekdayUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function usSessionKind(ymd: string): UsSessionKind {
  const dow = weekdayUtc(ymd);
  if (dow === 0 || dow === 6) return "closed";
  const { holidays, earlyCloses } = loadUsCalendar();
  if (holidays.has(ymd)) return "closed";
  if (earlyCloses.has(ymd)) return "early-close";
  return "open";
}

export function previousUsSession(ymd: string): string {
  let cur = addCalendarDays(ymd, -1);
  for (let i = 0; i < 40; i++) {
    const kind = usSessionKind(cur);
    if (kind === "open" || kind === "early-close") return cur;
    cur = addCalendarDays(cur, -1);
  }
  throw new Error(`no previous US session before ${ymd}`);
}

export type UsTradableKind = "open" | "early-close";

export type UsMarketClock = {
  wallYmd: string;
  wallKind: UsSessionKind;
  reportYmd: string;
  reportKind: UsSessionKind;
  lastComplete: { ymd: string; kind: UsTradableKind };
};

function asTradable(ymd: string): { ymd: string; kind: UsTradableKind } {
  const kind = usSessionKind(ymd);
  if (kind === "closed") {
    throw new Error(`expected tradable session, got closed ${ymd}`);
  }
  return { ymd, kind };
}

export function lastCompletedUsSession(now: Date): {
  ymd: string;
  kind: UsTradableKind;
} {
  return usMarketClock(now).lastComplete;
}

export function usMarketClock(now: Date): UsMarketClock {
  const { ymd } = wallClock(now, US_TZ);
  const wallKind = usSessionKind(ymd);
  let reportYmd = ymd;
  while (weekdayUtc(reportYmd) === 0 || weekdayUtc(reportYmd) === 6) {
    reportYmd = addCalendarDays(reportYmd, -1);
  }
  let reportKind = usSessionKind(reportYmd);

  if (reportKind === "open" || reportKind === "early-close") {
    const closeHour = reportKind === "early-close" ? 13 : 16;
    if (regularSessionClosed(now, US_TZ, closeHour, 5)) {
      return {
        wallYmd: ymd,
        wallKind,
        reportYmd,
        reportKind,
        lastComplete: { ymd: reportYmd, kind: reportKind },
      };
    }

    reportYmd = addCalendarDays(reportYmd, -1);
    while (weekdayUtc(reportYmd) === 0 || weekdayUtc(reportYmd) === 6) {
      reportYmd = addCalendarDays(reportYmd, -1);
    }
    reportKind = usSessionKind(reportYmd);
  }

  return {
    wallYmd: ymd,
    wallKind,
    reportYmd,
    reportKind,
    lastComplete: asTradable(
      reportKind === "closed" ? previousUsSession(reportYmd) : reportYmd,
    ),
  };
}

function mondayOfWeek(ymd: string): string {
  const dow = weekdayUtc(ymd);
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addCalendarDays(ymd, mondayOffset);
}

export function isFirstUsSessionOfWeek(ymd: string): boolean {
  const kind = usSessionKind(ymd);
  if (kind === "closed") return false;
  const prev = previousUsSession(ymd);
  return mondayOfWeek(ymd) !== mondayOfWeek(prev);
}
