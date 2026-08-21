import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DailyReport,
  GenerateState,
  ThesisRecord,
  UniverseItem,
  UniversePayload,
} from "./types";
import { writeFileAtomic } from "./shared/atomic-write";
import { withFileLease } from "./shared/file-lock";
import { HK_REF, SEED_UNIVERSE, US_REF } from "./universe";
import { reportIds } from "./universe-query";

export { intersectReport, reportIds } from "./universe-query";

const DATA = path.join(process.cwd(), "data");
const STATE = path.join(DATA, "state.json");
const THESIS = path.join(DATA, "thesis.json");
const LATEST = path.join(DATA, "latest.json");
const STATUS = path.join(DATA, "status.json");
const UNIVERSE_PATH = path.join(DATA, "universe.json");
const UNIVERSE_LOCK_RESOURCE = path.join(DATA, "locks", "universe.resource");

export interface MorningReportRunAudit {
  pipelineId: "morning";
  runId: string;
  beijingDate: string;
  generatedAt: string;
  marketSnapshotId: string;
  reportAudit: DailyReport["audit"];
}

export type JobState = "idle" | "running" | "ok" | "error";

export interface JobStatus {
  state: JobState;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
}

async function ensureDirs() {
  await fs.mkdir(DATA, { recursive: true });
}

export async function loadThesis(): Promise<Record<string, ThesisRecord>> {
  try {
    const raw = await fs.readFile(THESIS, "utf8");
    const parsed = JSON.parse(raw) as Record<string, ThesisRecord | string>;
    const out: Record<string, ThesisRecord> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("_") || typeof value !== "object" || !value) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadState(): Promise<GenerateState> {
  try {
    const raw = await fs.readFile(STATE, "utf8");
    return JSON.parse(raw) as GenerateState;
  } catch {
    return {};
  }
}

export async function saveState(state: GenerateState): Promise<void> {
  await ensureDirs();
  await fs.writeFile(STATE, JSON.stringify(state, null, 2));
}

function morningReportsRoot(baseDir?: string): string {
  return path.join(baseDir ?? DATA, "runs", "morning");
}

function validMorningRunId(runId: string): boolean {
  return /^morning-[A-Za-z0-9-]+$/.test(runId);
}

async function readDailyReport(file: string): Promise<DailyReport | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as DailyReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function saveReport(report: DailyReport, baseDir?: string): Promise<void> {
  const latest = path.join(baseDir ?? DATA, "latest.json");
  await writeFileAtomic(latest, JSON.stringify(report, null, 2));
}

export async function saveMorningReportRun(input: {
  runId: string;
  report: DailyReport;
  marketSnapshotId: string;
  baseDir?: string;
}): Promise<void> {
  if (!validMorningRunId(input.runId)) {
    throw new Error(`invalid morning run id: ${input.runId}`);
  }
  const root = morningReportsRoot(input.baseDir);
  await fs.mkdir(root, { recursive: true });

  const finalDir = path.join(root, input.runId);
  const existing = await fs.stat(finalDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    throw new Error(`morning report run already exists: ${input.runId}`);
  }

  const claim = path.join(root, `.claim-${input.runId}`);
  const claimHandle = await fs.open(claim, "wx").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`morning report run already exists: ${input.runId}`);
    }
    throw error;
  });
  await claimHandle.close();

  const tempDir = path.join(root, `.tmp-${input.runId}-${crypto.randomUUID()}`);
  const audit: MorningReportRunAudit = {
    pipelineId: "morning",
    runId: input.runId,
    beijingDate: input.report.beijingDate,
    generatedAt: input.report.generatedAt,
    marketSnapshotId: input.marketSnapshotId,
    reportAudit: input.report.audit,
  };
  try {
    await fs.mkdir(tempDir);
    await Promise.all([
      fs.writeFile(path.join(tempDir, "report.json"), JSON.stringify(input.report, null, 2), {
        encoding: "utf8",
        flag: "wx",
      }),
      fs.writeFile(path.join(tempDir, "audit.json"), JSON.stringify(audit, null, 2), {
        encoding: "utf8",
        flag: "wx",
      }),
    ]);
    await fs.rename(tempDir, finalDir);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.unlink(claim).catch(() => undefined);
  }

  await saveReport(input.report, input.baseDir);
}

export async function loadMorningReportRun(
  runId: string,
  baseDir?: string,
): Promise<DailyReport | null> {
  if (!validMorningRunId(runId)) return null;
  return readDailyReport(path.join(morningReportsRoot(baseDir), runId, "report.json"));
}

export async function loadMorningReportRunAudit(
  runId: string,
  baseDir?: string,
): Promise<MorningReportRunAudit | null> {
  if (!validMorningRunId(runId)) return null;
  try {
    return JSON.parse(
      await fs.readFile(path.join(morningReportsRoot(baseDir), runId, "audit.json"), "utf8"),
    ) as MorningReportRunAudit;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function loadLatestReport(): Promise<DailyReport | null> {
  return readDailyReport(LATEST);
}

export function latestReportPath(): string {
  return LATEST;
}

function isUniverseItem(value: unknown): value is UniverseItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.display === "string" &&
    item.display.length > 0 &&
    typeof item.name === "string" &&
    item.name.length > 0 &&
    typeof item.yahoo === "string" &&
    item.yahoo.length > 0 &&
    (item.market === "US" || item.market === "HK") &&
    typeof item.benchmark === "string" &&
    item.benchmark.length > 0 &&
    typeof item.group === "string" &&
    item.group.length > 0
  );
}

async function writeUniverseUnlocked(items: UniverseItem[]): Promise<void> {
  if (items.length === 0 || !items.every(isUniverseItem)) {
    throw new Error("universe must contain valid items");
  }
  await ensureDirs();
  await writeFileAtomic(UNIVERSE_PATH, `${JSON.stringify({ items }, null, 2)}\n`);
}

async function withUniverseLease<T>(work: () => Promise<T>): Promise<T> {
  return withFileLease(UNIVERSE_LOCK_RESOURCE, work, {
    staleMs: 15 * 60 * 1000,
    updateMs: 5 * 60 * 1000,
    retries: { retries: 10, minTimeout: 10, maxTimeout: 50, randomize: true },
  });
}

function parseUniverseItems(raw: string): UniverseItem[] {
  const parsed = JSON.parse(raw) as { items?: unknown };
  const list = Array.isArray(parsed.items) ? parsed.items : [];
  const items: UniverseItem[] = [];
  for (const entry of list) {
    if (!isUniverseItem(entry)) continue;
    items.push({
      ...entry,
      notes: Array.isArray(entry.notes) ? entry.notes : [],
      identity: Array.isArray(entry.identity) ? entry.identity : [],
    });
  }
  return items;
}

async function loadUniverseUnlocked(): Promise<UniverseItem[]> {
  let raw: string;
  try {
    raw = await fs.readFile(UNIVERSE_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await writeUniverseUnlocked(SEED_UNIVERSE);
      return SEED_UNIVERSE;
    }
    throw err;
  }

  const items = parseUniverseItems(raw);
  if (items.length === 0) {
    throw new Error("universe.json has no valid items");
  }
  return items;
}

export async function loadUniverse(): Promise<UniverseItem[]> {
  try {
    const raw = await fs.readFile(UNIVERSE_PATH, "utf8");
    const items = parseUniverseItems(raw);
    if (items.length === 0) throw new Error("universe.json has no valid items");
    return items;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return withUniverseLease(loadUniverseUnlocked);
  }
}

export async function updateUniverse(
  update: (items: UniverseItem[]) => UniverseItem[] | Promise<UniverseItem[]>,
): Promise<UniverseItem[]> {
  return withUniverseLease(async () => {
    const current = await loadUniverseUnlocked();
    const next = await update(current);
    await writeUniverseUnlocked(next);
    return next;
  });
}

export function buildUniversePayloadFrom(
  items: UniverseItem[],
  report: DailyReport | null,
): UniversePayload {
  const universeIds = new Set(items.map((item) => item.id));
  const rawIds = reportIds(report);
  const shown = [...rawIds].filter((id) => universeIds.has(id));
  const pendingIds = items.map((item) => item.id).filter((id) => !rawIds.has(id));
  const staleStats = [...rawIds].some((id) => !universeIds.has(id));
  const referenced = new Set<string>([US_REF, HK_REF]);
  for (const item of items) {
    if (item.benchmark) referenced.add(item.benchmark);
    if (item.underlying) referenced.add(item.underlying);
  }
  return {
    items,
    pendingIds,
    reportIds: shown,
    referencedBenchmarks: [...referenced],
    staleStats,
  };
}

export async function buildUniversePayload(): Promise<UniversePayload> {
  const [items, report] = await Promise.all([loadUniverse(), loadLatestReport()]);
  return buildUniversePayloadFrom(items, report);
}

export async function writeJobStatus(status: JobStatus): Promise<void> {
  await ensureDirs();
  await fs.writeFile(STATUS, JSON.stringify(status, null, 2));
}

export async function loadJobStatus(): Promise<JobStatus> {
  try {
    return JSON.parse(await fs.readFile(STATUS, "utf8")) as JobStatus;
  } catch {
    return { state: "idle" };
  }
}

export function isJobLive(status: JobStatus, staleMs = 60 * 60 * 1000): boolean {
  if (status.state !== "running" || !status.startedAt) return false;
  const started = Date.parse(status.startedAt);
  if (Number.isNaN(started)) return false;
  return Date.now() - started < staleMs;
}
