import { readFileSync } from "node:fs";
import path from "node:path";
import type { UniverseItem } from "../types";

export type UnderlyingKind = "equity" | "etf";

export interface Underlying {
  id: string;
  asset: string;
  name: string;
  yahoo: string;
  market: string;
  kind: UnderlyingKind;
  officialFirstSession?: string | null;
  historyStartDate?: string | null;
  historySource?: string | null;
  identity: string[];
  benchmarks: string[];
  notes: string[];
}

export interface SecurityMaster {
  version: number;
  underlyings: Underlying[];
}

export interface ExecutionTool {
  id: string;
  display: string;
  yahoo: string;
  asset: string;
  leverage: number;
  reset: "daily";
  issuer: string;
  underlyingId: string;
  expenseNote: string;
  officialUrl: string;
  name: string;
  identityAll: string[];
  identityNone?: string[];
  notes?: string[];
}

export interface ExecutionToolsPayload {
  version: number;
  tools: ExecutionTool[];
}

export type PositionStatus = "FLAT" | "OPEN" | "UNKNOWN";

export interface Position {
  asset: string;
  status: PositionStatus;
  openedSession?: string | null;
  entryUnderlyingPrice?: number | null;
  priceInvalidation?: number | null;
  thesisInvalidated?: boolean;
}

export interface PositionsPayload {
  version: number;
  updatedAt: string | null;
  positions: Position[];
}

const ROOT = path.join(process.cwd(), "data", "short-monitor");

function readJson<T>(fileName: string): T {
  const raw = readFileSync(path.join(ROOT, fileName), "utf8");
  return JSON.parse(raw) as T;
}

export function loadSecurityMaster(): SecurityMaster {
  return readJson<SecurityMaster>("security-master.json");
}

export function loadExecutionTools(): ExecutionToolsPayload {
  return readJson<ExecutionToolsPayload>("execution-tools.json");
}

export function loadPositions(): PositionsPayload {
  return readJson<PositionsPayload>("positions.json");
}

export function cutHistory<T extends { date: string }>(
  bars: T[],
  historyStartDate: string | null | undefined,
): T[] {
  if (!historyStartDate) return bars.slice();
  return bars.filter((bar) => bar.date >= historyStartDate);
}

export function assertHistoryBounds(underlying: Underlying): void {
  const first = underlying.officialFirstSession;
  const start = underlying.historyStartDate;
  if (first != null && start != null && first !== start) {
    throw new Error(
      `history bounds disagree for ${underlying.id}: officialFirstSession=${first} historyStartDate=${start}`,
    );
  }
}

export function underlyingByAsset(asset: string): Underlying | undefined {
  return loadSecurityMaster().underlyings.find((u) => u.asset === asset);
}

export function buildShortMonitorUniverseItems(): UniverseItem[] {
  const master = loadSecurityMaster();
  const byYahoo = new Map<string, UniverseItem>();
  for (const underlying of master.underlyings) {
    byYahoo.set(underlying.yahoo, {
      id: underlying.id,
      display: underlying.id,
      name: underlying.name,
      yahoo: underlying.yahoo,
      market: "US",
      benchmark: underlying.benchmarks[0] ?? "QQQ",
      group: "空头",
      notes: underlying.notes.slice(),
      identity: underlying.identity.slice(),
    });
  }
  for (const tool of loadExecutionTools().tools) {
    if (byYahoo.has(tool.yahoo)) continue;
    const underlying = master.underlyings.find((candidate) => candidate.id === tool.underlyingId);
    byYahoo.set(tool.yahoo, {
      id: tool.id,
      display: tool.display,
      name: tool.name,
      yahoo: tool.yahoo,
      market: "US",
      benchmark: underlying?.benchmarks[0] ?? "QQQ",
      group: "空头",
      notes: tool.notes?.slice() ?? [],
      identity: tool.identityAll.slice(),
    });
  }
  return [...byYahoo.values()];
}
