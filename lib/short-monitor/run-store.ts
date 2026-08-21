import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../shared/atomic-write";
import type { DayRunRecord } from "../shared/run-lock";
import { beijingDate } from "../time";
import type { DeepSeekOutput, EvidenceItem, ShortMonitorReport } from "./types";

function rootDir(baseDir?: string): string {
  return baseDir ?? path.join(process.cwd(), "data", "short-monitor");
}

function latestPath(baseDir?: string): string {
  return path.join(rootDir(baseDir), "latest.json");
}

function validRunId(runId: string): boolean {
  return /^short-[A-Za-z0-9-]+$/.test(runId);
}

function parseReport(value: unknown): ShortMonitorReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<ShortMonitorReport>;
  if (
    typeof report.runId !== "string" ||
    !validRunId(report.runId) ||
    typeof report.beijingDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(report.beijingDate) ||
    typeof report.marketSnapshotId !== "string" ||
    report.overnight_snapshot !== true ||
    !report.decision ||
    report.decision.runId !== report.runId ||
    report.decision.marketSnapshotId !== report.marketSnapshotId ||
    !report.dataCutoff ||
    typeof report.generatedAt !== "string" ||
    Number.isNaN(Date.parse(report.generatedAt)) ||
    beijingDate(new Date(report.generatedAt)) !== report.beijingDate ||
    typeof report.dataCutoff.snapshotGeneratedAt !== "string" ||
    Number.isNaN(Date.parse(report.dataCutoff.snapshotGeneratedAt)) ||
    (report.status !== "ok" && report.status !== "degraded" && report.status !== "failed")
  ) {
    return null;
  }
  return report as ShortMonitorReport;
}

async function readReport(file: string): Promise<ShortMonitorReport | null> {
  try {
    return parseReport(JSON.parse(await fs.readFile(file, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function shortMonitorLatestPath(baseDir?: string): Promise<string> {
  return latestPath(baseDir);
}

export async function loadShortMonitorReport(
  baseDir?: string,
): Promise<ShortMonitorReport | null> {
  return readReport(latestPath(baseDir));
}

export async function loadShortMonitorRunReport(
  runId: string,
  baseDir?: string,
): Promise<ShortMonitorReport | null> {
  if (!validRunId(runId)) return null;
  return readReport(path.join(rootDir(baseDir), "runs", runId, "report.json"));
}

export async function loadCurrentShortMonitorReport(input: {
  beijingDate: string;
  morningSnapshotId: string | null;
  dayRun: DayRunRecord | null;
  baseDir?: string;
}): Promise<ShortMonitorReport | null> {
  const dayRun = input.dayRun;
  if (
    !dayRun ||
    (dayRun.status !== "success" && dayRun.status !== "degraded") ||
    !input.morningSnapshotId ||
    dayRun.marketSnapshotId !== input.morningSnapshotId
  ) {
    return null;
  }
  const report = await loadShortMonitorRunReport(dayRun.runId, input.baseDir);
  if (
    !report ||
    report.runId !== dayRun.runId ||
    report.beijingDate !== input.beijingDate ||
    report.marketSnapshotId !== input.morningSnapshotId ||
    (dayRun.status === "success" && report.status !== "ok") ||
    (dayRun.status === "degraded" && report.status !== "degraded")
  ) {
    return null;
  }
  return report;
}

export type ShortMonitorRunAudit = {
  pipelineId: "short-monitor";
  beijingDate: string;
  startedAt: string;
  finishedAt: string;
  dataCutoff: ShortMonitorReport["dataCutoff"];
  promptHash: string;
  promptVersion: number;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  attempts: number;
  schemaVersion: number;
  scoreVersion: number;
  sourcesUsed: string[];
  gaps: unknown[];
};

export async function saveShortMonitorRun(input: {
  runId: string;
  report: ShortMonitorReport;
  evidence: EvidenceItem[];
  derived: unknown;
  modelOutput: DeepSeekOutput | null;
  decision: ShortMonitorReport["decision"];
  audit: ShortMonitorRunAudit;
  baseDir?: string;
}): Promise<void> {
  if (!validRunId(input.runId)) throw new Error(`invalid short-monitor run id: ${input.runId}`);
  const root = rootDir(input.baseDir);
  const runs = path.join(root, "runs");
  await fs.mkdir(runs, { recursive: true });
  const claim = path.join(runs, `.claim-${input.runId}`);
  const claimHandle = await fs.open(claim, "wx").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`short-monitor run already exists: ${input.runId}`);
    }
    throw error;
  });
  await claimHandle.close();

  const tempDir = path.join(runs, `.tmp-${input.runId}-${randomUUID()}`);
  const finalDir = path.join(runs, input.runId);
  try {
    await fs.mkdir(tempDir);
    const manifest = {
      runId: input.runId,
      marketSnapshotId: input.report.marketSnapshotId,
      status: input.report.status,
      degradationReason: input.report.degradationReason,
      ...input.audit,
    };
    const files: Array<[string, unknown]> = [
      ["manifest.json", manifest],
      ["evidence.json", input.evidence],
      ["derived.json", input.derived],
      ["model-output.json", input.modelOutput],
      ["decision.json", input.decision],
      ["report.json", input.report],
    ];
    await Promise.all(
      files.map(([name, value]) =>
        fs.writeFile(path.join(tempDir, name), JSON.stringify(value, null, 2), {
          encoding: "utf8",
          flag: "wx",
        }),
      ),
    );
    await fs.rename(tempDir, finalDir);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.unlink(claim).catch(() => undefined);
  }
  await writeFileAtomic(latestPath(input.baseDir), JSON.stringify(input.report, null, 2));
}
