import { promises as fs } from "node:fs";
import path from "node:path";
import type { DailyReport, GenerateState, ThesisRecord } from "./types";

const DATA = path.join(process.cwd(), "data");
const STATE = path.join(DATA, "state.json");
const THESIS = path.join(DATA, "thesis.json");
const LATEST = path.join(DATA, "latest.json");
const STATUS = path.join(DATA, "status.json");

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

export async function saveReport(report: DailyReport): Promise<void> {
  await ensureDirs();
  await fs.writeFile(LATEST, JSON.stringify(report, null, 2));
}

export async function loadLatestReport(): Promise<DailyReport | null> {
  try {
    const raw = await fs.readFile(LATEST, "utf8");
    return JSON.parse(raw) as DailyReport;
  } catch {
    return null;
  }
}

export function latestReportPath(): string {
  return LATEST;
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

export function isJobLive(status: JobStatus, staleMs = 10 * 60 * 1000): boolean {
  if (status.state !== "running" || !status.startedAt) return false;
  const started = Date.parse(status.startedAt);
  if (Number.isNaN(started)) return false;
  return Date.now() - started < staleMs;
}
