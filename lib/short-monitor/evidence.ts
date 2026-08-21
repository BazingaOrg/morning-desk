import { promises as fs } from "node:fs";
import path from "node:path";
import type { MarketSnapshot } from "../shared/market-snapshot";
import { writeFileExclusiveAtomic } from "../shared/atomic-write";
import type {
  AssetId,
  CollectorResult,
  EvidenceCapability,
  EvidenceItem,
  EvidencePacket,
} from "./types";
import { collectCalendarEvidence } from "./sources/calendar";
import { collectCatalystEvidence } from "./sources/catalyst";
import { collectCftcEvidence } from "./sources/cftc";
import { collectFredEvidence } from "./sources/fred";
import {
  collectMarketContext,
  type MarketCollection,
} from "./sources/market";
import { collectSecEvidence } from "./sources/sec";

async function settled(
  label: string,
  affectedAssets: AssetId[],
  capability: EvidenceCapability,
  run: () => CollectorResult | Promise<CollectorResult>,
): Promise<CollectorResult> {
  try {
    return await run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      items: [],
      gaps: [{
        source: label,
        affectedAssets,
        capability,
        blocking: true,
        message: `${label} failed: ${msg}`,
      }],
      sourcesUsed: [],
    };
  }
}

function dedupItems(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export async function collectEvidence(
  snapshot: MarketSnapshot,
): Promise<EvidencePacket> {
  return (await collectEvidenceContext(snapshot)).packet;
}

export async function collectEvidenceContext(
  snapshot: MarketSnapshot,
): Promise<{ packet: EvidencePacket; market: MarketCollection; collectedAt: string }> {
  const collectedAt = new Date().toISOString();
  const observedSnapshot = { ...snapshot, generatedAt: collectedAt };
  const emptyMarket = (message: string): MarketCollection => ({
    items: [],
    gaps: [{
      source: "market",
      affectedAssets: ["SPCX", "SNDK", "NASDAQ", "GOLD"],
      capability: "PRICE",
      blocking: true,
      message,
    }],
    sourcesUsed: [],
    assetPacks: {
      SPCX: { bars: [], stale: false, session: null, dataConflict: false },
      SNDK: { bars: [], stale: false, session: null, dataConflict: false },
      NASDAQ: { bars: [], stale: false, session: null, dataConflict: false },
      GOLD: { bars: [], stale: false, session: null, dataConflict: false },
    },
  });
  const marketPromise = collectMarketContext(observedSnapshot).catch((error) =>
    emptyMarket(`market failed: ${error instanceof Error ? error.message : String(error)}`),
  );
  const results = await Promise.all([
    settled("calendar", ["SPCX", "SNDK", "NASDAQ", "GOLD"], "CALENDAR", () => collectCalendarEvidence(observedSnapshot)),
    settled("sec", ["SPCX", "SNDK"], "FUNDAMENTAL", () => collectSecEvidence(observedSnapshot)),
    settled("fred", ["NASDAQ", "GOLD"], "RATES", () => collectFredEvidence(observedSnapshot)),
    settled("cftc", ["GOLD"], "POSITIONING", () => collectCftcEvidence(observedSnapshot)),
    settled("catalyst", ["SPCX", "SNDK", "NASDAQ", "GOLD"], "CATALYST", () => collectCatalystEvidence(observedSnapshot)),
  ]);
  const market = await marketPromise;
  results.push(market);

  const items: EvidenceItem[] = [];
  const gaps: CollectorResult["gaps"] = [];
  const sources = new Set<string>();

  for (const result of results) {
    items.push(...result.items);
    gaps.push(...result.gaps);
    for (const src of result.sourcesUsed) sources.add(src);
  }

  return {
    packet: {
      items: dedupItems(items),
      gaps: [...new Map(gaps.map((gap) => [`${gap.source}:${gap.message}`, gap])).values()],
      sourcesUsed: [...sources],
    },
    market,
    collectedAt,
  };
}

type FrozenEvidenceContext = Awaited<ReturnType<typeof collectEvidenceContext>> & {
  snapshotId: string;
};

function frozenEvidencePath(snapshotId: string, baseDir?: string): string {
  return path.join(
    baseDir ?? path.join(process.cwd(), "data"),
    "short-monitor",
    "evidence-snapshots",
    `${snapshotId}.json`,
  );
}

async function readFrozenEvidence(
  snapshotId: string,
  baseDir?: string,
): Promise<FrozenEvidenceContext | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(frozenEvidencePath(snapshotId, baseDir), "utf8"),
    ) as FrozenEvidenceContext;
    if (
      parsed.snapshotId !== snapshotId || !parsed.packet || !parsed.market ||
      !Array.isArray(parsed.packet.items) || !Array.isArray(parsed.packet.gaps) ||
      typeof parsed.collectedAt !== "string" || Number.isNaN(Date.parse(parsed.collectedAt))
    ) {
      throw new Error(`invalid frozen evidence snapshot: ${snapshotId}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function loadOrCollectEvidenceContext(
  snapshot: MarketSnapshot,
  baseDir?: string,
): Promise<FrozenEvidenceContext> {
  const existing = await readFrozenEvidence(snapshot.id, baseDir);
  if (existing) return existing;
  const collected = await collectEvidenceContext(snapshot);
  const frozen = { snapshotId: snapshot.id, ...collected };
  try {
    await writeFileExclusiveAtomic(
      frozenEvidencePath(snapshot.id, baseDir),
      JSON.stringify(frozen, null, 2),
    );
    return frozen;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const winner = await readFrozenEvidence(snapshot.id, baseDir);
    if (!winner) throw new Error(`frozen evidence race lost without winner: ${snapshot.id}`);
    return winner;
  }
}
