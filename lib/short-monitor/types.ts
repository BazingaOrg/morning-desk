import type { SessionFreshness } from "../shared/session";

export type AssetId = "SPCX" | "SNDK" | "NASDAQ" | "GOLD";

export type Action = "WAIT" | "PREPARE" | "ENTER" | "HOLD" | "REDUCE" | "EXIT";

export type PositionStatus = "FLAT" | "OPEN" | "UNKNOWN";

export type MonitorState = "WATCH" | "ARMED" | "CONFIRMING" | "TRIGGERED";

export type { SessionFreshness } from "../shared/session";
export type { MarketSnapshot } from "../shared/market-snapshot";

export type SessionKind = "regular" | "early-close" | "closed";

export type EvidenceAsset = AssetId | "MACRO";

export type SourceTier = 1 | 2 | 3 | 4;

export type TierLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type EvidenceItem = {
  id: string;
  asset: EvidenceAsset;
  kind: string;
  observedAt: string;
  publishedAt?: string;
  period?: string;
  sourceTier: SourceTier;
  sourceName: string;
  sourceUrl: string;
  title: string;
  value?: number | string;
  unit?: string;
  summary: string;
  verified: boolean;
  stale: boolean;
  limitations: string[];
};

export type AssetModelView = {
  consensus: string;
  variant: string;
  falsification: string;
  inflection: string;
  fundamentalShift: TierLevel;
  expectationGap: TierLevel;
  catalystStrength: TierLevel;
  evidenceConfidence: TierLevel;
  priceReactionFunction: TierLevel;
  evidenceIds: string[];
  bullCase: string;
  bearCase: string;
  missingData: string[];
};

export type DeepSeekAssetMap = {
  SPCX: AssetModelView;
  SNDK: AssetModelView;
  NASDAQ: AssetModelView;
  GOLD: AssetModelView;
};

export type DeepSeekOutput = {
  schemaVersion: number;
  assets: DeepSeekAssetMap;
  notes?: string;
};

export type AssetDecisionInput = {
  asset: AssetId;
  model: Pick<
    AssetModelView,
    | "fundamentalShift"
    | "expectationGap"
    | "catalystStrength"
    | "evidenceConfidence"
    | "evidenceIds"
  >;
  priceConfirmation: boolean;
  independentDrivers: number;
  rr: number | null;
  blockingVetoes: string[];
  thesisEntry: boolean;
  priceEntry: boolean;
  catalystEntry: boolean;
  position: PositionStatus;
  thesisStop?: boolean;
  timeStop?: boolean;
  ttlExpired?: boolean;
};

export type AssetDecideResult = {
  score: number;
  state: MonitorState;
  action: Action;
  reasons: string[];
  entryIsCandidate?: boolean;
};

export type AssetDecision = {
  asset: AssetId;
  state: MonitorState;
  score: number | null;
  action: Action | null;
  vetoes: string[];
  rr: number | null;
  priceConfirmation: TierLevel | null;
  executionTool: string | null;
  stop: string | null;
  exit: string | null;
  reason: string;
};

export type DecisionResult = {
  runId: string;
  marketSnapshotId: string;
  position: PositionStatus;
  action: Action;
  bestOpportunity: AssetId | "None";
  assets: AssetDecision[];
  degradations: string[];
  generatedAt: string;
};

export type ShortMonitorReport = {
  runId: string;
  marketSnapshotId: string;
  overnight_snapshot: true;
  position: PositionStatus;
  decision: DecisionResult;
  modelOutput: DeepSeekOutput | null;
  status: "ok" | "degraded" | "failed";
  degradationReason: string | null;
  generatedAt: string;
};

export type FixtureSession = {
  beijingDate: string;
  usSession: {
    date: string;
    kind: SessionKind;
  };
  freshness: SessionFreshness;
  overnight_snapshot: true;
  marketSnapshotId?: string;
  morningPublished?: boolean;
  shortMonitorStatus?: "ok" | "degraded" | "failed";
  degradationReason?: string | null;
};

export type HistoryCutSample = {
  historyStartDate: string;
  inputDates: string[];
  expectedRemainingDates: string[];
};

export type ShortMonitorFixture = {
  id: string;
  title: string;
  asserts: string[];
  session: FixtureSession;
  position: PositionStatus;
  notes: string;
  sampleBars?: {
    SPCX: HistoryCutSample;
    SNDK: HistoryCutSample;
  };
};
