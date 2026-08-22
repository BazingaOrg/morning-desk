import { generateReport } from "./report";
import {
  acquireRunLock,
  dayRunKey,
  readDayRun,
  releaseRunLock,
  writeDayRun,
  type RunLockHandle,
} from "./shared/run-lock";
import { writeJobStatus } from "./store";
import { beijingDate } from "./time";
import type { DailyReport } from "./types";

const RUNNING_MESSAGE = "正在拉取完整交易日收盘";

export async function markGenerateRunning(): Promise<void> {
  await writeJobStatus({
    state: "running",
    startedAt: new Date().toISOString(),
    message: RUNNING_MESSAGE,
  });
}

export async function runGenerateBody(): Promise<DailyReport> {
  const bj = beijingDate();
  try {
    const report = await generateReport();
    await writeJobStatus({
      state: "ok",
      startedAt: undefined,
      finishedAt: new Date().toISOString(),
      message: `美股 ${report.us.label} ｜ 港股 ${report.hk.label}`,
    });
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJobStatus({
      state: "error",
      finishedAt: new Date().toISOString(),
      message,
    });
    const existing = await readDayRun("morning", bj).catch(() => null);
    if (existing?.status !== "success") {
      await writeDayRun("morning", bj, {
        status: "failed",
        runId: `morning-fail-${bj}-${Date.now()}`,
        finishedAt: new Date().toISOString(),
        error: message,
        attempts: (existing?.attempts ?? 0) + 1,
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function startGenerateIfIdle(
  schedule: (work: () => void | Promise<void>) => void,
): Promise<boolean> {
  const bj = beijingDate();
  const key = dayRunKey("morning", bj);
  const lock = await acquireRunLock("morning", key);
  if (!lock) return false;
  try {
    await markGenerateRunning();
    schedule(async () => {
      try {
        await runGenerateBody();
      } catch {
        // status already recorded
      } finally {
        await releaseRunLock(lock);
      }
    });
    return true;
  } catch (error) {
    await releaseRunLock(lock);
    throw error;
  }
}

export async function runGenerate(): Promise<DailyReport> {
  const bj = beijingDate();
  const key = dayRunKey("morning", bj);
  const lock = await acquireRunLock("morning", key);
  if (!lock) {
    throw new Error("generate already running");
  }
  try {
    await markGenerateRunning();
    return await runGenerateBody();
  } finally {
    await releaseRunLock(lock);
  }
}

export type { RunLockHandle };
