import type {
  AssetId,
  AssetModelView,
  EvidenceCluster,
  EvidenceGap,
  EvidenceItem,
} from "./types";

const DRIVER_CLUSTERS = new Set<EvidenceCluster>([
  "RATES",
  "LIQUIDITY",
  "POSITIONING",
  "COMPANY",
]);

function isRelevant(asset: AssetId, item: EvidenceItem): boolean {
  return item.asset === asset || (item.asset === "MACRO" && item.relevantAssets.includes(asset));
}

function thesisClusters(asset: AssetId): Set<EvidenceCluster> {
  if (asset === "SPCX" || asset === "SNDK") return new Set(["COMPANY"]);
  if (asset === "NASDAQ") return new Set(["RATES", "LIQUIDITY", "COMPANY"]);
  return new Set(["RATES", "LIQUIDITY", "POSITIONING"]);
}

function driverClusters(asset: AssetId): Set<EvidenceCluster> {
  if (asset === "SPCX" || asset === "SNDK") {
    return new Set(["RATES", "LIQUIDITY", "POSITIONING"]);
  }
  return DRIVER_CLUSTERS;
}

export function deriveDecisionEvidence(input: {
  asset: AssetId;
  model: AssetModelView;
  items: EvidenceItem[];
  gaps: EvidenceGap[];
}): {
  cited: EvidenceItem[];
  bearishClusters: EvidenceCluster[];
  independentDrivers: number;
  trustedThesisEvidence: boolean;
  trustedEvidence: boolean;
  catalystPresent: boolean;
  blockingGaps: string[];
} {
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const cited = input.model.evidenceIds
    .map((id) => byId.get(id))
    .filter((item): item is EvidenceItem => Boolean(item))
    .filter((item) => isRelevant(input.asset, item));
  const trusted = cited.filter((item) => item.verified && !item.stale);
  const bearishClusters = [...new Set(
    trusted
      .filter((item) => item.signal === "BEARISH" && driverClusters(input.asset).has(item.cluster))
      .map((item) => item.cluster),
  )];
  const allowedThesisClusters = thesisClusters(input.asset);
  const trustedThesisEvidence = trusted.some(
    (item) => item.signal === "BEARISH" && allowedThesisClusters.has(item.cluster),
  );
  const catalystPresent = trusted.some((item) => item.cluster === "CATALYST");
  const blockingGaps = input.gaps
    .filter((gap) => gap.blocking && gap.affectedAssets.includes(input.asset))
    .map((gap) => `${gap.capability.toLowerCase()}-gap:${gap.message}`);

  return {
    cited,
    bearishClusters,
    independentDrivers: bearishClusters.length,
    trustedThesisEvidence,
    trustedEvidence: trusted.length > 0,
    catalystPresent,
    blockingGaps,
  };
}
