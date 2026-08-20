import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileExclusiveAtomic } from "./atomic-write";
import type { UsSessionKind } from "./calendar";
import type { SessionFreshness } from "./session";

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

export async function saveMarketSnapshot(
  s: MarketSnapshot,
  baseDir?: string,
): Promise<void> {
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
  try {
    const raw = await fs.readFile(
      path.join(snapshotsDir(baseDir), `${id}.json`),
      "utf8",
    );
    return JSON.parse(raw) as MarketSnapshot;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
