import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write";
import { acquireFileLease, type FileLease } from "./file-lock";

export type PipelineId = "morning" | "short-monitor";

export type DayRunStatus = "success" | "failed" | "running" | "degraded";

export type DayRunRecord = {
  status: DayRunStatus;
  runId: string;
  startedAt?: string;
  finishedAt?: string;
  marketSnapshotId?: string;
  error?: string;
};

export type RunLockHandle = {
  pipelineId: PipelineId;
  token: string;
  runKey: string;
  baseDir?: string;
};

const DEFAULT_LEASE_MS = 15 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 5 * 60 * 1000;
const leases = new Map<string, FileLease>();

function dataRoot(baseDir?: string): string {
  return baseDir ?? path.join(process.cwd(), "data");
}

function lockResource(pipelineId: string, baseDir?: string): string {
  return path.join(dataRoot(baseDir), "locks", `${pipelineId}.resource`);
}

function dayRunPath(
  pipelineId: PipelineId,
  beijingDate: string,
  baseDir?: string,
): string {
  return path.join(dataRoot(baseDir), "runs", pipelineId, `${beijingDate}.json`);
}

function handleKey(handle: RunLockHandle): string {
  return `${handle.baseDir ?? ""}::${handle.pipelineId}::${handle.token}`;
}

export async function acquireRunLock(
  pipelineId: PipelineId,
  runKey: string,
  leaseMs: number = DEFAULT_LEASE_MS,
  baseDir?: string,
  heartbeatMs: number = DEFAULT_HEARTBEAT_MS,
): Promise<RunLockHandle | null> {
  const lease = await acquireFileLease(lockResource(pipelineId, baseDir), {
    staleMs: leaseMs,
    updateMs: heartbeatMs > 0 ? heartbeatMs : undefined,
  });
  if (!lease) return null;

  const handle = {
    pipelineId,
    token: randomBytes(16).toString("hex"),
    runKey,
    baseDir,
  };
  leases.set(handleKey(handle), lease);
  return handle;
}

export async function releaseRunLock(handle: RunLockHandle): Promise<void> {
  const key = handleKey(handle);
  const lease = leases.get(key);
  if (!lease) return;
  leases.delete(key);
  await lease.release();
}

export function dayRunKey(pipelineId: PipelineId, beijingDate: string): string {
  return `${pipelineId}:${beijingDate}`;
}

export async function readDayRun(
  pipelineId: PipelineId,
  beijingDate: string,
  baseDir?: string,
): Promise<DayRunRecord | null> {
  try {
    const raw = await fs.readFile(dayRunPath(pipelineId, beijingDate, baseDir), "utf8");
    return JSON.parse(raw) as DayRunRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeDayRun(
  pipelineId: PipelineId,
  beijingDate: string,
  record: DayRunRecord,
  baseDir?: string,
): Promise<void> {
  const file = dayRunPath(pipelineId, beijingDate, baseDir);
  await writeFileAtomic(file, JSON.stringify(record, null, 2));
}
