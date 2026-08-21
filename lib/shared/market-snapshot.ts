import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileExclusiveAtomic } from "./atomic-write";
import type { UsSessionKind } from "./calendar";
import type { SessionFreshness } from "./session";
import { beijingDate } from "../time";
import type { SeriesBundle } from "../types";

export type { SessionFreshness };

export interface MarketSnapshot {
  id: string;
  kind: "overnight_snapshot";
  beijingDate: string;
  generatedAt: string;
  us: {
    sessionDate: string | null;
    freshness: SessionFreshness;
    kind: UsSessionKind | "unavailable";
    wallYmd: string;
    wallKind: UsSessionKind;
    reportYmd: string;
    reportKind: UsSessionKind;
    lastCompleteYmd: string | null;
  };
  hk: {
    sessionDate: string | null;
    freshness: SessionFreshness;
  };
  marketSeries?: Record<string, SeriesBundle>;
}

export function classifyUsFreshness(input: {
  reportKind: UsSessionKind;
  expectedCompleteSession: string | null;
  barSession: string | null;
  lastSuccessSession: string | null | undefined;
  usedStaleCache: boolean;
  completeKind?: UsSessionKind;
}): SessionFreshness {
  if (input.reportKind === "closed") return "closed";
  if (!input.barSession) return "unavailable";
  if (input.usedStaleCache) return "stale";
  if (input.barSession !== input.expectedCompleteSession) {
    if (!input.expectedCompleteSession) return "unavailable";
    return "stale";
  }
  if (input.barSession === input.lastSuccessSession) return "unchanged";
  if (input.completeKind === "early-close" || input.reportKind === "early-close") {
    return "early-close";
  }
  return "new";
}

function snapshotsDir(baseDir?: string): string {
  return path.join(baseDir ?? path.join(process.cwd(), "data"), "snapshots");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isNullableYmd(value: unknown): value is string | null {
  return value === null || isYmd(value);
}

export function parseMarketSnapshot(value: unknown): MarketSnapshot | null {
  if (!isRecord(value) || !isRecord(value.us) || !isRecord(value.hk)) return null;
  const freshness = new Set(["new", "unchanged", "closed", "early-close", "stale", "unavailable"]);
  const usKinds = new Set(["open", "early-close", "closed", "unavailable"]);
  const wallKinds = new Set(["open", "early-close", "closed"]);
  if (
    typeof value.id !== "string" ||
    !/^ms-[A-Za-z0-9-]+$/.test(value.id) ||
    value.kind !== "overnight_snapshot" ||
    !isYmd(value.beijingDate) ||
    typeof value.generatedAt !== "string" ||
    Number.isNaN(Date.parse(value.generatedAt)) ||
    beijingDate(new Date(value.generatedAt)) !== value.beijingDate ||
    !isNullableYmd(value.us.sessionDate) ||
    typeof value.us.freshness !== "string" ||
    !freshness.has(value.us.freshness) ||
    typeof value.us.kind !== "string" ||
    !usKinds.has(value.us.kind) ||
    !isYmd(value.us.wallYmd) ||
    typeof value.us.wallKind !== "string" ||
    !wallKinds.has(value.us.wallKind) ||
    !isYmd(value.us.reportYmd) ||
    typeof value.us.reportKind !== "string" ||
    !wallKinds.has(value.us.reportKind) ||
    !isNullableYmd(value.us.lastCompleteYmd) ||
    !isNullableYmd(value.hk.sessionDate) ||
    typeof value.hk.freshness !== "string" ||
    !freshness.has(value.hk.freshness)
  ) {
    return null;
  }
  if (value.marketSeries !== undefined && !isRecord(value.marketSeries)) return null;
  if ((value.us.reportKind === "closed") !== (value.us.freshness === "closed")) return null;
  if (value.us.freshness === "early-close" && value.us.reportKind !== "early-close") {
    return null;
  }
  if (value.us.freshness === "new" && value.us.reportKind !== "open") return null;
  if (
    (value.us.freshness === "new" || value.us.freshness === "early-close") &&
    (value.us.reportKind === "closed" ||
      value.us.sessionDate !== value.us.lastCompleteYmd)
  ) {
    return null;
  }
  return value as unknown as MarketSnapshot;
}

export function assertMarketSnapshotForRun(
  snapshot: MarketSnapshot,
  expected: { id: string; beijingDate: string },
): void {
  if (snapshot.id !== expected.id) {
    throw new Error(`market snapshot id mismatch: expected=${expected.id} actual=${snapshot.id}`);
  }
  if (snapshot.beijingDate !== expected.beijingDate) {
    throw new Error(
      `market snapshot date mismatch: expected=${expected.beijingDate} actual=${snapshot.beijingDate}`,
    );
  }
}

export async function saveMarketSnapshot(
  s: MarketSnapshot,
  baseDir?: string,
): Promise<void> {
  if (!parseMarketSnapshot(s)) throw new Error(`invalid market snapshot: ${s.id}`);
  const dir = snapshotsDir(baseDir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${s.id}.json`);
  try {
    await writeFileExclusiveAtomic(file, JSON.stringify(s, null, 2));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`market snapshot already exists: ${s.id}`);
    }
    throw err;
  }
}

export async function loadMarketSnapshot(
  id: string,
  baseDir?: string,
): Promise<MarketSnapshot | null> {
  if (!/^ms-[A-Za-z0-9-]+$/.test(id)) {
    throw new Error(`invalid market snapshot id: ${id}`);
  }
  try {
    const raw = await fs.readFile(
      path.join(snapshotsDir(baseDir), `${id}.json`),
      "utf8",
    );
    const parsed = parseMarketSnapshot(JSON.parse(raw) as unknown);
    if (!parsed) throw new Error(`invalid market snapshot: ${id}`);
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
