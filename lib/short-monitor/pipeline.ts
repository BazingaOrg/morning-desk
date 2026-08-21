import path from "node:path";
import { analyzeShortMonitor } from "../ai/short-monitor-analyst";
import { periodReturn } from "../calc";
import type { DailyBar } from "../types";
import {
  assertMarketSnapshotForRun,
  loadMarketSnapshot,
  type MarketSnapshot,
} from "../shared/market-snapshot";
import { decideAsset } from "./decision-validator";
import { deriveDecisionEvidence } from "./decision-evidence";
import { loadOrCollectEvidenceContext } from "./evidence";
import { atr, sma } from "./features";
import { loadExecutionTools, loadPositions } from "./master";
import { deriveOpenLifecycle } from "./open-lifecycle";
import { rrFromLevels } from "./risk-reward";
import { loadShortMonitorReport, saveShortMonitorRun } from "./run-store";
import { SCORE_VERSION, isMediumOrAbove } from "./score";
import { daysBetween } from "../time";
import { isFirstUsSessionOfWeek } from "../shared/calendar";
import { priceConfirmed } from "./sources/market";
import { collectBlockingVetoes } from "./veto";
import type {
  Action,
  AssetDecision,
  AssetId,
  AssetModelView,
  DeepSeekOutput,
  EvidenceItem,
  ShortMonitorReport,
  TierLevel,
} from "./types";

const ASSETS: AssetId[] = ["SPCX", "SNDK", "NASDAQ", "GOLD"];

function noneView(): AssetModelView {
  return {
    consensus: "模型未产出可用档位。",
    variant: "",
    falsification: "",
    inflection: "",
    fundamentalShift: "NONE",
    expectationGap: "NONE",
    catalystStrength: "NONE",
    evidenceConfidence: "NONE",
    priceReactionFunction: "NONE",
    evidenceIds: [],
    bullCase: "",
    bearCase: "",
    missingData: ["model_unavailable"],
  };
}

function swingHigh(
  bars: { date: string; high: number | null; close: number | null }[],
  lastDate: string,
): number | null {
  const series = bars.filter((bar) => bar.date <= lastDate);
  const window = series.slice(-20);
  const highs = window
    .map((bar) => bar.high ?? bar.close)
    .filter((value): value is number => value != null);
  return highs.length ? Math.max(...highs) : null;
}

export function priceRelatedVetoes(input: {
  eligible: boolean;
  reason: string | null;
  stale: boolean;
  barCount: number;
  tool: string | null;
  rr: number | null;
  dataConflict?: boolean;
  binaryEventNear?: boolean;
  leverageDecayHigh?: boolean;
}): {
  staleData: boolean;
  historyShort: boolean;
  toolStaleOrUnverified: boolean;
  rrMissingOrBelowMin: boolean;
  dataConflict: boolean;
  binaryEventNear: boolean;
  leverageDecayHigh: boolean;
  extra: string[];
} {
  return {
    staleData: input.reason === "stale-price" || (input.eligible && input.stale),
    historyShort: input.eligible && input.barCount < 20,
    toolStaleOrUnverified: input.eligible && input.tool == null,
    rrMissingOrBelowMin: input.eligible && (input.rr == null || input.rr < 2),
    dataConflict: input.dataConflict === true,
    binaryEventNear: input.binaryEventNear === true,
    leverageDecayHigh: input.leverageDecayHigh === true,
    extra: input.reason ? [input.reason] : [],
  };
}

const BINARY_CATALYSTS = new Set(["earnings", "fomc", "cpi", "nfp", "refund", "financing"]);

export function binaryEventNear(
  asset: AssetId,
  evidence: EvidenceItem[],
  from: string,
): boolean {
  return evidence.some((item) => {
    if (
      item.cluster !== "CATALYST" || !item.verified || item.stale || !item.period ||
      !item.relevantAssets.includes(asset)
    ) return false;
    const distance = daysBetween(from, item.period);
    return distance >= 0 && distance <= 2 && BINARY_CATALYSTS.has(item.kind.toLowerCase());
  });
}

export function leverageDecayIsHigh(input: {
  tool: string | null;
  atr14: number | null;
  lastClose: number | null;
}): boolean {
  if (!input.tool || input.atr14 == null || input.lastClose == null || input.lastClose <= 0) {
    return false;
  }
  const tool = loadExecutionTools().tools.find((candidate) => candidate.id === input.tool);
  return Boolean(tool && Math.abs(tool.leverage) >= 2 && input.atr14 / input.lastClose >= 0.04);
}

export function priceScoringEligibility(
  snapshot: MarketSnapshot,
  pack: { stale: boolean; session: string | null },
): { eligible: boolean; reason: string | null } {
  if (snapshot.us.reportKind === "closed" || snapshot.us.freshness === "closed") {
    return { eligible: false, reason: "closed-session" };
  }
  if (snapshot.us.freshness !== "new" && snapshot.us.freshness !== "early-close") {
    return { eligible: false, reason: `${snapshot.us.freshness}-session` };
  }
  if (
    !snapshot.us.lastCompleteYmd ||
    snapshot.us.sessionDate !== snapshot.us.lastCompleteYmd
  ) {
    return { eligible: false, reason: "snapshot-session-mismatch" };
  }
  if (pack.stale) return { eligible: false, reason: "stale-price" };
  if (pack.session !== snapshot.us.lastCompleteYmd) {
    return { eligible: false, reason: "market-session-mismatch" };
  }
  return { eligible: true, reason: null };
}

export function pickTool(
  asset: AssetId,
  evidence: EvidenceItem[],
  session: string | null,
): string | null {
  if (!session) return null;
  const candidates = loadExecutionTools().tools.filter((tool) => tool.asset === asset);
  for (const tool of candidates) {
    const quote = evidence.find(
      (item) =>
        item.id === `ev-tool-${tool.id}-close-${session}` &&
        item.kind === "execution-tool-close" &&
        item.period === session &&
        item.verified &&
        !item.stale,
    );
    if (quote) return tool.id;
  }
  return null;
}

export function rankAction(assets: AssetDecision[]): Action {
  if (assets.some((asset) => asset.action === "EXIT")) return "EXIT";
  if (assets.some((asset) => asset.action === "REDUCE")) return "REDUCE";
  if (assets.some((asset) => asset.action === "ENTER")) return "ENTER";
  if (assets.some((asset) => asset.action === "HOLD")) return "HOLD";
  if (assets.some((asset) => asset.action === "PREPARE")) return "PREPARE";
  return "WAIT";
}

export function bestOpportunity(assets: AssetDecision[]): AssetId | "None" {
  const ranked = assets
    .filter((asset) => asset.action === "ENTER")
    .sort(
      (left, right) =>
        (right.score ?? 0) - (left.score ?? 0) ||
        (right.rr ?? 0) - (left.rr ?? 0),
    );
  return ranked[0]?.asset ?? "None";
}

const GROWTH_CLUSTER: ReadonlySet<AssetId> = new Set([
  "SPCX",
  "SNDK",
  "NASDAQ",
]);

export function applyClusterRisk(
  assets: AssetDecision[],
  maxEntries = 2,
): { assets: AssetDecision[]; downgradedAssets: AssetId[] } {
  const entries = assets
    .filter(
      (asset) => GROWTH_CLUSTER.has(asset.asset) && asset.action === "ENTER",
    )
    .sort(
      (left, right) =>
        (right.score ?? 0) - (left.score ?? 0) ||
        (right.rr ?? 0) - (left.rr ?? 0),
    );
  const downgraded = new Set(entries.slice(Math.max(0, maxEntries)).map((asset) => asset.asset));
  return {
    assets: assets.map((asset) =>
      downgraded.has(asset.asset)
        ? {
            ...asset,
            action: "PREPARE",
            vetoes: [...new Set([...asset.vetoes, "cluster-overlap"])],
            executionTool: null,
            reason: "cluster-overlap",
          }
        : asset,
    ),
    downgradedAssets: [...downgraded],
  };
}

export function priceFeatureSnapshot(
  bars: DailyBar[],
  lastDate: string,
  eligible: boolean,
): {
  lastClose: number | null;
  dma20: number | null;
  ret1D: number | null;
  atr14: number | null;
  swingHigh20: number | null;
  target2Atr: number | null;
} {
  if (!eligible || !lastDate) {
    return {
      lastClose: null,
      dma20: null,
      ret1D: null,
      atr14: null,
      swingHigh20: null,
      target2Atr: null,
    };
  }
  const series = bars.filter((bar) => bar.date <= lastDate && bar.close != null);
  if (!series.length || series.at(-1)?.date !== lastDate) {
    return {
      lastClose: null,
      dma20: null,
      ret1D: null,
      atr14: null,
      swingHigh20: null,
      target2Atr: null,
    };
  }
  const closes = series.map((bar) => bar.close as number);
  const lastClose = closes.at(-1) ?? null;
  const atr14 = atr(bars, 14);
  return {
    lastClose,
    dma20: sma(closes, 20),
    ret1D: periodReturn(bars, lastDate, 1, false),
    atr14,
    swingHigh20: swingHigh(bars, lastDate),
    target2Atr:
      lastClose != null && atr14 != null ? lastClose - 2 * atr14 : null,
  };
}

export async function runShortMonitorPipeline(input: {
  runId: string;
  beijingDate: string;
  marketSnapshotId: string;
  startedAt: string;
  dataBaseDir?: string;
}): Promise<ShortMonitorReport> {
  const snapshot = await loadMarketSnapshot(input.marketSnapshotId, input.dataBaseDir);
  if (!snapshot) throw new Error(`market snapshot not found: ${input.marketSnapshotId}`);
  assertMarketSnapshotForRun(snapshot, {
    id: input.marketSnapshotId,
    beijingDate: input.beijingDate,
  });

  const shortMonitorBaseDir = input.dataBaseDir
    ? path.join(input.dataBaseDir, "short-monitor")
    : undefined;
  const previousReport = await loadShortMonitorReport(shortMonitorBaseDir);

  const evidenceContext = await loadOrCollectEvidenceContext(snapshot, input.dataBaseDir);
  const packet = evidenceContext.packet;
  const analyst = await analyzeShortMonitor({
    evidence: packet.items,
    evidenceJson: JSON.stringify({
      snapshotId: snapshot.id,
      beijingDate: snapshot.beijingDate,
      gaps: packet.gaps,
      items: packet.items,
    }),
  });
  const degradationMessages = packet.gaps.map((gap) => gap.message);
  if (analyst.error) degradationMessages.push(analyst.error);

  const model: DeepSeekOutput | null = analyst.output;
  const positions = loadPositions();
  const lastDate = snapshot.us.lastCompleteYmd ?? "";
  const rawAssets: AssetDecision[] = [];
  const effectivePositions = [] as Array<"FLAT" | "OPEN" | "UNKNOWN">;
  const derivedEvidence: Record<string, unknown> = {};

  for (const asset of ASSETS) {
    const configuredPosition = positions.positions.find((position) => position.asset === asset);
    const view = model?.assets[asset] ?? noneView();
    const pack = evidenceContext.market.assetPacks[asset];
    const priceEligibility = priceScoringEligibility(snapshot, pack);
    const confirmed =
      priceEligibility.eligible && lastDate
        ? priceConfirmed(pack.bars, lastDate)
        : false;
    const features = priceFeatureSnapshot(
      pack.bars,
      lastDate,
      priceEligibility.eligible,
    );
    const lastClose = features.lastClose;
    const stop = features.swingHigh20;
    const target = features.target2Atr;
    const rr =
      lastClose != null && stop != null && target != null
        ? rrFromLevels(lastClose, stop, target)
        : null;
    const decisionEvidence = deriveDecisionEvidence({
      asset,
      model: view,
      items: packet.items,
      gaps: packet.gaps,
    });
    const lifecycle = deriveOpenLifecycle({
      position: configuredPosition,
      currentSession: snapshot.us.lastCompleteYmd,
      lastClose,
      priceEligible: priceEligibility.eligible,
    });
    effectivePositions.push(lifecycle.position);
    const thesisChanges =
      view.fundamentalShift !== "NONE" || view.expectationGap !== "NONE";
    const evidenceUnverified =
      thesisChanges &&
      (!decisionEvidence.trustedThesisEvidence ||
        !isMediumOrAbove(view.evidenceConfidence));
    const tool = priceEligibility.eligible
      ? pickTool(asset, packet.items, lastDate || null)
      : null;
    const priceVetoes = priceRelatedVetoes({
      eligible: priceEligibility.eligible,
      reason: priceEligibility.reason,
      stale: pack.stale,
      barCount: pack.bars.length,
      tool,
      rr,
      dataConflict: pack.dataConflict,
      binaryEventNear: binaryEventNear(asset, packet.items, snapshot.beijingDate),
      leverageDecayHigh: leverageDecayIsHigh({
        tool,
        atr14: features.atr14,
        lastClose,
      }),
    });
    const vetoes = collectBlockingVetoes({
      ...priceVetoes,
      unverifiedThesis: evidenceUnverified,
      extra: [
        ...priceVetoes.extra,
        ...decisionEvidence.blockingGaps,
        ...lifecycle.vetoes,
      ],
    });
    const decided = decideAsset({
      asset,
      model: view,
      priceConfirmation: confirmed,
      independentDrivers: decisionEvidence.independentDrivers,
      rr,
      blockingVetoes: vetoes,
      thesisEntry:
        isMediumOrAbove(view.fundamentalShift) &&
        decisionEvidence.trustedThesisEvidence,
      priceEntry: confirmed,
      catalystEntry:
        isMediumOrAbove(view.catalystStrength) && decisionEvidence.catalystPresent,
      position: lifecycle.position,
      thesisStop: lifecycle.thesisStop,
      priceStop: lifecycle.priceStop,
      timeStop: lifecycle.timeStop,
      ttlExpired: lifecycle.ttlExpired,
    });

    rawAssets.push({
      asset,
      state: decided.state,
      score: decided.score,
      action: decided.action,
      vetoes,
      rr,
      priceConfirmation: (confirmed ? "HIGH" : "NONE") as TierLevel,
      trigger: confirmed ? "close-below-20dma-and-negative-1d" : null,
      executionTool: tool,
      stop: stop == null ? null : String(stop),
      exit: target == null ? null : String(target),
      reason:
        decided.reasons[0] ??
        priceEligibility.reason ??
        (confirmed ? "price-confirmed" : "no-price-confirmation"),
    });
    derivedEvidence[asset] = {
      market: {
        session: pack.session,
        stale: pack.stale,
        barCountAfterHistoryCut: pack.bars.length,
      },
      priceEligibility,
      features,
      priceConfirmation: confirmed,
      rr,
      positionInput: configuredPosition
        ? {
            status: configuredPosition.status,
            openedSession: configuredPosition.openedSession ?? null,
            entryUnderlyingPrice: configuredPosition.entryUnderlyingPrice ?? null,
            priceInvalidation: configuredPosition.priceInvalidation ?? null,
            thesisInvalidated: configuredPosition.thesisInvalidated === true,
          }
        : null,
      lifecycle,
      modelTiers: {
        fundamentalShift: view.fundamentalShift,
        expectationGap: view.expectationGap,
        catalystStrength: view.catalystStrength,
        evidenceConfidence: view.evidenceConfidence,
      },
      citedEvidenceIds: decisionEvidence.cited.map((item) => item.id),
      bearishClusters: decisionEvidence.bearishClusters,
      independentDrivers: decisionEvidence.independentDrivers,
      trustedThesisEvidence: decisionEvidence.trustedThesisEvidence,
      catalystPresent: decisionEvidence.catalystPresent,
      blockingGaps: decisionEvidence.blockingGaps,
      selectedTool: tool,
      blockingVetoes: vetoes,
      decision: decided,
    };
  }

  const clusterRisk = applyClusterRisk(rawAssets);
  const assets = clusterRisk.assets;
  for (const asset of clusterRisk.downgradedAssets) {
    const archived = derivedEvidence[asset] as Record<string, unknown>;
    archived.clusterRisk = {
      cluster: "AI_GROWTH_RATES",
      outcome: "downgraded",
      reason: "cluster-overlap",
    };
  }
  for (const asset of assets) {
    const archived = derivedEvidence[asset.asset] as Record<string, unknown>;
    archived.finalDecision = asset;
  }

  const generatedAt = new Date().toISOString();
  const status = analyst.output && packet.gaps.length === 0 ? "ok" : "degraded";
  const aggregatePosition = effectivePositions.some((position) => position === "UNKNOWN")
    ? "UNKNOWN"
    : effectivePositions.some((position) => position === "OPEN")
      ? "OPEN"
      : "FLAT";
  const dataCutoff: ShortMonitorReport["dataCutoff"] = {
    snapshotGeneratedAt: snapshot.generatedAt,
    evidenceCollectedAt: evidenceContext.collectedAt,
    usSession: snapshot.us.lastCompleteYmd,
    usFreshness: snapshot.us.freshness,
    usReportKind: snapshot.us.reportKind,
  };
  const catalysts = packet.items
    .filter((item) =>
      item.cluster === "CATALYST" && item.verified && !item.stale && Boolean(item.period),
    )
    .map((item) => ({
      id: item.id,
      date: item.period as string,
      title: item.title,
      kind: item.kind,
      sourceUrl: item.sourceUrl,
      relevantAssets: item.relevantAssets,
    }));
  const catalysts7d = catalysts.filter((item) => {
    const distance = daysBetween(snapshot.beijingDate, item.date);
    return distance >= 0 && distance <= 7;
  });
  const catalysts30d = snapshot.us.lastCompleteYmd &&
    isFirstUsSessionOfWeek(snapshot.us.lastCompleteYmd)
    ? catalysts.filter((item) => {
        const distance = daysBetween(snapshot.beijingDate, item.date);
        return distance >= 0 && distance <= 30;
      })
    : [];
  const historyChanges = assets.map((asset) => {
    const previous = previousReport?.decision.assets.find((row) => row.asset === asset.asset);
    return {
      asset: asset.asset,
      previousState: previous?.state ?? null,
      currentState: asset.state,
      previousScore: previous?.score ?? null,
      currentScore: asset.score,
      scoreDelta:
        previous?.score != null && asset.score != null ? asset.score - previous.score : null,
    };
  });
  const report: ShortMonitorReport = {
    runId: input.runId,
    beijingDate: input.beijingDate,
    marketSnapshotId: snapshot.id,
    overnight_snapshot: true,
    dataCutoff,
    position: aggregatePosition,
    decision: {
      runId: input.runId,
      marketSnapshotId: snapshot.id,
      position: aggregatePosition,
      action: rankAction(assets),
      bestOpportunity: bestOpportunity(assets),
      assets,
      degradations: [...new Set(degradationMessages)],
      generatedAt,
    },
    evidence: packet.items,
    gaps: packet.gaps,
    catalysts7d,
    catalysts30d,
    historyChanges,
    modelOutput: model,
    status,
    degradationReason: analyst.error ?? packet.gaps[0]?.message ?? null,
    generatedAt,
  };

  await saveShortMonitorRun({
    runId: input.runId,
    report,
    evidence: packet.items,
    derived: {
      gaps: packet.gaps,
      decisionEvidence: derivedEvidence,
      clusterRisk: {
        cluster: "AI_GROWTH_RATES",
        maxEntries: 2,
        downgradedAssets: clusterRisk.downgradedAssets,
      },
    },
    modelOutput: model,
    decision: report.decision,
    audit: {
      pipelineId: "short-monitor",
      beijingDate: input.beijingDate,
      startedAt: input.startedAt,
      finishedAt: generatedAt,
      dataCutoff,
      promptHash: analyst.promptHash,
      promptVersion: analyst.promptVersion,
      model: analyst.model,
      ...(analyst.usage ? { usage: analyst.usage } : {}),
      attempts: analyst.attempts,
      schemaVersion: model?.schemaVersion ?? 1,
      scoreVersion: SCORE_VERSION,
      sourcesUsed: packet.sourcesUsed,
      gaps: packet.gaps,
    },
    ...(shortMonitorBaseDir ? { baseDir: shortMonitorBaseDir } : {}),
  });
  return report;
}
