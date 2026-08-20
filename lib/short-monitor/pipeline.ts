import { promises as fs } from "node:fs";
import path from "node:path";
import { loadMarketSnapshot } from "../shared/market-snapshot";
import {
  acquireRunLock,
  dayRunKey,
  readDayRun,
  releaseRunLock,
  writeDayRun,
} from "../shared/run-lock";
import { beijingDate } from "../time";

const SHORT_LATEST = path.join(process.cwd(), "data", "short-monitor", "latest.json");

export type ShortMonitorStubResult = {
  status: "degraded";
  reason: string;
  marketSnapshotId: string;
  beijingDate: string;
  kind: "overnight_snapshot";
};

export async function runShortMonitorStub(now: Date = new Date()): Promise<ShortMonitorStubResult> {
  const bj = beijingDate(now);
  const key = dayRunKey("short-monitor", bj);
  const lock = await acquireRunLock("short-monitor", key);
  if (!lock) {
    throw new Error("short-monitor already running");
  }

  try {
    const morning = await readDayRun("morning", bj);
    if (!morning || morning.status !== "success" || !morning.marketSnapshotId) {
      throw new Error("morning day-run missing or not success; refuse to invent snapshot");
    }

    const snapshot = await loadMarketSnapshot(morning.marketSnapshotId);
    if (!snapshot) {
      throw new Error(`market snapshot not found: ${morning.marketSnapshotId}`);
    }

    const payload: ShortMonitorStubResult = {
      status: "degraded",
      reason: "short-monitor engine reserved for Batch B",
      marketSnapshotId: snapshot.id,
      beijingDate: bj,
      kind: "overnight_snapshot",
    };

    await fs.mkdir(path.dirname(SHORT_LATEST), { recursive: true });
    const tmp = `${SHORT_LATEST}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tmp, SHORT_LATEST);

    await writeDayRun("short-monitor", bj, {
      status: "degraded",
      runId: `short-${bj}-${Date.now()}`,
      finishedAt: new Date().toISOString(),
      marketSnapshotId: snapshot.id,
      error: payload.reason,
    });

    return payload;
  } finally {
    await releaseRunLock(lock);
  }
}
