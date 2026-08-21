import { randomUUID } from "node:crypto";
import {
  acquireRunLock,
  dayRunKey,
  readDayRun,
  releaseRunLock,
  writeDayRun,
  type DayRunRecord,
  type RunLockHandle,
} from "../shared/run-lock";
import { beijingDate } from "../time";
import { runShortMonitorPipeline } from "./pipeline";
import type { ShortMonitorReport } from "./types";

export type ShortMonitorClaim = {
  lock: RunLockHandle;
  runId: string;
  beijingDate: string;
  marketSnapshotId: string;
  startedAt: string;
  baseDir?: string;
};

export type ShortMonitorClaimResult =
  | { status: "started"; claim: ShortMonitorClaim }
  | { status: "busy" }
  | { status: "complete"; dayRun: DayRunRecord }
  | { status: "failed"; dayRun: DayRunRecord }
  | { status: "blocked"; reason: string };

export async function claimShortMonitorRun(
  now: Date = new Date(),
  options: { retryFailed?: boolean; baseDir?: string } = {},
): Promise<ShortMonitorClaimResult> {
  const bj = beijingDate(now);
  const lock = await acquireRunLock(
    "short-monitor",
    dayRunKey("short-monitor", bj),
    undefined,
    options.baseDir,
  );
  if (!lock) return { status: "busy" };
  try {
    const morning = await readDayRun("morning", bj, options.baseDir);
    if (morning?.status !== "success" || !morning.marketSnapshotId) {
      await releaseRunLock(lock);
      return { status: "blocked", reason: "morning day-run missing or not success" };
    }
    const current = await readDayRun("short-monitor", bj, options.baseDir);
    const sameSnapshot = current?.marketSnapshotId === morning.marketSnapshotId;
    if (sameSnapshot && (current?.status === "success" || current?.status === "degraded")) {
      await releaseRunLock(lock);
      return { status: "complete", dayRun: current };
    }
    if (sameSnapshot && current?.status === "failed" && !options.retryFailed) {
      await releaseRunLock(lock);
      return { status: "failed", dayRun: current };
    }

    const startedAt = new Date().toISOString();
    const claim: ShortMonitorClaim = {
      lock,
      runId: `short-${bj}-${randomUUID()}`,
      beijingDate: bj,
      marketSnapshotId: morning.marketSnapshotId,
      startedAt,
      ...(options.baseDir ? { baseDir: options.baseDir } : {}),
    };
    await writeDayRun("short-monitor", bj, {
      status: "running",
      runId: claim.runId,
      startedAt,
      marketSnapshotId: claim.marketSnapshotId,
    }, options.baseDir);
    return { status: "started", claim };
  } catch (error) {
    await releaseRunLock(lock);
    throw error;
  }
}

export async function executeShortMonitorClaim(
  claim: ShortMonitorClaim,
): Promise<ShortMonitorReport> {
  try {
    const report = await runShortMonitorPipeline({
      runId: claim.runId,
      beijingDate: claim.beijingDate,
      marketSnapshotId: claim.marketSnapshotId,
      startedAt: claim.startedAt,
      ...(claim.baseDir ? { dataBaseDir: claim.baseDir } : {}),
    });
    await writeDayRun("short-monitor", claim.beijingDate, {
      status: report.status === "ok" ? "success" : report.status,
      runId: claim.runId,
      startedAt: claim.startedAt,
      finishedAt: report.generatedAt,
      marketSnapshotId: claim.marketSnapshotId,
      ...(report.degradationReason ? { error: report.degradationReason } : {}),
    }, claim.baseDir);
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeDayRun("short-monitor", claim.beijingDate, {
      status: "failed",
      runId: claim.runId,
      startedAt: claim.startedAt,
      finishedAt: new Date().toISOString(),
      marketSnapshotId: claim.marketSnapshotId,
      error: message,
    }, claim.baseDir).catch(() => undefined);
    throw error;
  } finally {
    await releaseRunLock(claim.lock);
  }
}

export async function startShortMonitorIfIdle(
  schedule: (work: () => void | Promise<void>) => void,
  now: Date = new Date(),
): Promise<ShortMonitorClaimResult["status"]> {
  const result = await claimShortMonitorRun(now, { retryFailed: true });
  if (result.status !== "started") return result.status;
  try {
    schedule(async () => {
      await executeShortMonitorClaim(result.claim).catch(() => undefined);
    });
    return "started";
  } catch (error) {
    await writeDayRun("short-monitor", result.claim.beijingDate, {
      status: "failed",
      runId: result.claim.runId,
      startedAt: result.claim.startedAt,
      finishedAt: new Date().toISOString(),
      marketSnapshotId: result.claim.marketSnapshotId,
      error: error instanceof Error ? error.message : String(error),
    }, result.claim.baseDir).catch(() => undefined);
    await releaseRunLock(result.claim.lock);
    throw error;
  }
}

export async function runShortMonitor(
  now: Date = new Date(),
  options: { retryFailed?: boolean } = {},
): Promise<ShortMonitorReport> {
  const result = await claimShortMonitorRun(now, options);
  if (result.status !== "started") {
    throw new Error(`short-monitor not started: ${result.status}`);
  }
  return executeShortMonitorClaim(result.claim);
}

export async function runShortMonitorStub(now: Date = new Date()) {
  const report = await runShortMonitor(now, { retryFailed: true });
  return {
    status: report.status,
    reason: report.degradationReason ?? report.status,
    marketSnapshotId: report.marketSnapshotId,
    beijingDate: report.beijingDate,
    kind: "overnight_snapshot" as const,
  };
}
