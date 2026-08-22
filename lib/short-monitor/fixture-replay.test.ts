import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { saveMarketSnapshot } from "../shared/market-snapshot";
import { runShortMonitorPipeline } from "./pipeline";
import type {
  AssetDecision,
  AssetId,
  AssetModelView,
  DeepSeekOutput,
  EvidenceItem,
  ShortMonitorFixture,
  ShortMonitorReport,
} from "./types";
import type { DailyBar } from "../types";

const FIXTURE_DIR = path.join(process.cwd(), "data", "short-monitor", "fixtures");
const SESSION = "2026-08-18";
const OBSERVED = "2026-08-19T01:00:05.000Z";
const SEC_ID = "ev-sec-companyfacts-SPCX-revenue-2025-12-31";
const CATALYST_ID = "ev-cat-quarterly-earnings-review-2026-08-25";
const RATES_ID = "ev-fred-10y-2026-08-18";

type AssetPack = {
  bars: DailyBar[];
  stale: boolean;
  session: string | null;
  dataConflict: boolean;
};

function loadFixture(id: string): ShortMonitorFixture {
  return JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, `${id}.json`), "utf8"),
  ) as ShortMonitorFixture;
}

function weekdayDates(endingAt: string, count: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${endingAt}T12:00:00Z`);
  while (out.length < count) {
    const iso = cursor.toISOString().slice(0, 10);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) out.unshift(iso);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

function barSeries(
  closes: number[],
  range: number,
  endDate = SESSION,
  spikeIndex = -1,
  spikeHigh = 0,
): DailyBar[] {
  return weekdayDates(endDate, closes.length).map((date, index) => ({
    date,
    open: closes[index],
    high:
      index === spikeIndex
        ? Math.max(spikeHigh, closes[index] + range)
        : closes[index] + range,
    low: closes[index] - range,
    close: closes[index],
    adjClose: closes[index],
    volume: 1000,
  }));
}

function emptyPack(): AssetPack {
  return { bars: [], stale: false, session: SESSION, dataConflict: false };
}

function toolClose(asset: AssetId, tool: string, close: number, session = SESSION): EvidenceItem {
  return {
    id: `ev-tool-${tool}-close-${session}`,
    asset,
    kind: "execution-tool-close",
    observedAt: OBSERVED,
    period: SESSION,
    sourceTier: 3,
    sourceName: "fixture-replay",
    sourceUrl: "https://example.com",
    title: `${tool} close ${SESSION}`,
    value: close,
    unit: "USD",
    summary: `${tool} close=${close}`,
    verified: true,
    stale: false,
    cluster: "MARKET",
    signal: "CONTEXT",
    relevantAssets: [asset],
    limitations: [],
  };
}

function bearishCompanyEvidence(): EvidenceItem {
  return {
    id: SEC_ID,
    asset: "SPCX",
    kind: "companyfacts-revenue",
    observedAt: OBSERVED,
    publishedAt: "2025-12-31",
    period: "2025-12-31",
    sourceTier: 1,
    sourceName: "SEC EDGAR",
    sourceUrl: "https://www.sec.gov",
    title: "SPCX revenue deterioration",
    value: -12,
    unit: "%",
    summary: "revenue yoy decline",
    verified: true,
    stale: false,
    cluster: "COMPANY",
    signal: "BEARISH",
    relevantAssets: ["SPCX"],
    limitations: [],
  };
}

function bearishCatalystEvidence(): EvidenceItem {
  return {
    id: CATALYST_ID,
    asset: "SPCX",
    kind: "quarterly-earnings-review",
    observedAt: OBSERVED,
    period: "2026-08-25",
    sourceTier: 2,
    sourceName: "company IR",
    sourceUrl: "https://example.com",
    title: "SPCX quarterly earnings node",
    value: undefined,
    summary: "official catalyst node outside the binary 2-day window",
    verified: true,
    stale: false,
    cluster: "CATALYST",
    signal: "BEARISH",
    relevantAssets: ["SPCX"],
    limitations: [],
  };
}

function bearishRatesEvidence(): EvidenceItem {
  return {
    id: RATES_ID,
    asset: "MACRO",
    kind: "treasury-yields",
    observedAt: OBSERVED,
    period: SESSION,
    sourceTier: 2,
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org",
    title: "10y yields repriced higher",
    value: 4.4,
    unit: "%",
    summary: "10Y +12bp on session",
    verified: true,
    stale: false,
    cluster: "RATES",
    signal: "BEARISH",
    relevantAssets: ["SPCX", "SNDK", "NASDAQ", "GOLD"],
    limitations: [],
  };
}

function modelView(
  partial: Partial<AssetModelView> & { consensus?: string },
): AssetModelView {
  return {
    consensus: "idle",
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
    missingData: ["fixture_replay"],
    ...partial,
  };
}

function modelFor(scenario: Partial<Record<AssetId, Partial<AssetModelView>>>): DeepSeekOutput {
  return {
    schemaVersion: 1,
    assets: {
      SPCX: modelView(scenario.SPCX ?? {}),
      SNDK: modelView(scenario.SNDK ?? {}),
      NASDAQ: modelView(scenario.NASDAQ ?? {}),
      GOLD: modelView(scenario.GOLD ?? {}),
    },
  };
}

function sessionKindOf(freshness: ShortMonitorFixture["session"]["freshness"]): "open" | "early-close" | "closed" {
  if (freshness === "early-close") return "early-close";
  if (freshness === "closed") return "closed";
  return "open";
}

function fixtureSnapshot(fixture: ShortMonitorFixture) {
  const date = fixture.session.usSession.date;
  const kind = sessionKindOf(fixture.session.freshness);
  return {
    id: fixture.session.marketSnapshotId as string,
    kind: "overnight_snapshot" as const,
    beijingDate: fixture.session.beijingDate,
    generatedAt: `${fixture.session.beijingDate}T01:00:00.000Z`,
    us: {
      sessionDate: date,
      freshness: fixture.session.freshness,
      kind,
      wallYmd: date,
      wallKind: kind,
      reportYmd: date,
      reportKind: kind,
      lastCompleteYmd: date,
    },
    hk: { sessionDate: null, freshness: "unavailable" as const },
  };
}

async function replayFixture(input: {
  id: string;
  items?: EvidenceItem[];
  assetPacks?: Partial<Record<AssetId, AssetPack>>;
  model: DeepSeekOutput;
  failModel?: boolean;
}): Promise<{ report: ShortMonitorReport; fixture: ShortMonitorFixture }> {
  const fixture = loadFixture(input.id);
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), `sm-fixture-${input.id}-`));
  try {
    await saveMarketSnapshot(fixtureSnapshot(fixture), baseDir);
    const frozenDir = path.join(baseDir, "short-monitor", "evidence-snapshots");
    await fs.mkdir(frozenDir, { recursive: true });
    await fs.writeFile(
      path.join(frozenDir, `${fixture.session.marketSnapshotId}.json`),
      JSON.stringify({
        snapshotId: fixture.session.marketSnapshotId,
        collectedAt: OBSERVED,
        packet: {
          items: input.items ?? [],
          gaps: [],
          sourcesUsed: ["fixture-replay"],
        },
        market: {
          items: [],
          gaps: [],
          sourcesUsed: [],
          assetPacks: {
            SPCX: emptyPack(),
            SNDK: emptyPack(),
            NASDAQ: emptyPack(),
            GOLD: emptyPack(),
            ...input.assetPacks,
          },
        },
      }),
      "utf8",
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(input.model) } }],
          model: "fixture-analyst",
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    try {
      const report = await runShortMonitorPipeline({
        runId: `short-fixture-${input.id}`,
        beijingDate: fixture.session.beijingDate,
        marketSnapshotId: fixture.session.marketSnapshotId as string,
        startedAt: OBSERVED,
        dataBaseDir: baseDir,
      });
      return { report, fixture };
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
}

const SPX_TRIGGER_VIEW: Partial<AssetModelView> = {
  fundamentalShift: "VERY_HIGH",
  expectationGap: "HIGH",
  catalystStrength: "HIGH",
  evidenceConfidence: "HIGH",
  evidenceIds: [SEC_ID, CATALYST_ID, RATES_ID],
};

const SPX_HEADLINE_VIEW: Partial<AssetModelView> = {
  fundamentalShift: "HIGH",
  expectationGap: "HIGH",
  catalystStrength: "VERY_HIGH",
  evidenceConfidence: "HIGH",
  evidenceIds: [SEC_ID, CATALYST_ID],
};

function assetRow(report: ShortMonitorReport, asset: AssetId): AssetDecision {
  const row = report.decision.assets.find((candidate) => candidate.asset === asset);
  assert.ok(row, `${asset} decision row missing`);
  return row;
}

describe("fixture replay through runShortMonitorPipeline", () => {
  before(() => {
    process.env.DEEPSEEK_API_KEY = "fixture-replay-key";
  });

  it("01-all-wait: normal session with no essential change stays WAIT", async () => {
    const { report } = await replayFixture({
      id: "01-all-wait",
      model: modelFor({}),
    });
    assert.equal(report.overnight_snapshot, true);
    assert.equal(report.position, "FLAT");
    assert.equal(report.decision.action, "WAIT");
    assert.equal(report.decision.bestOpportunity, "None");
    for (const row of report.decision.assets) {
      assert.equal(row.state, "WATCH");
      assert.equal(row.action, "WAIT");
      assert.equal(row.score, 0);
    }
    assert.equal(report.dataCutoff.usSession, SESSION);
    assert.equal(report.dataCutoff.usFreshness, "new");
  });

  it("04-headline-no-price: a single strong catalyst without price confirmation cannot enter", async () => {
    const closes = [99.8, 100.1, 99.9, 100.2, 100.0, 100.3, 100.1, 100.0, 100.2, 100.1, 100.3, 100.0, 100.1, 99.9, 100.2, 100.0, 100.1, 99.9, 100.0, 100.4];
    const { report } = await replayFixture({
      id: "04-headline-no-price",
      items: [bearishCompanyEvidence(), bearishCatalystEvidence()],
      assetPacks: { SPCX: { bars: barSeries(closes, 0.4), stale: false, session: SESSION, dataConflict: false } },
      model: modelFor({ SPCX: SPX_HEADLINE_VIEW }),
    });
    const spcx = assetRow(report, "SPCX");
    assert.equal(spcx.priceConfirmation, "NONE");
    assert.notEqual(spcx.state, "TRIGGERED");
    assert.ok(spcx.action === "WAIT" || spcx.action === "PREPARE");
    assert.notEqual(report.decision.action, "ENTER");
  });

  it("05-score-with-veto: a high pre-veto score is still forced down by the blocking veto", async () => {
    const closes = [105, ...Array.from({ length: 19 }, () => 100), 99.9];
    const { report } = await replayFixture({
      id: "05-score-with-veto",
      items: [bearishCompanyEvidence(), bearishCatalystEvidence(), bearishRatesEvidence()],
      assetPacks: { SPCX: { bars: barSeries(closes, 0.3, SESSION, 1, 101.3), stale: false, session: SESSION, dataConflict: false } },
      model: modelFor({
        SPCX: { ...SPX_TRIGGER_VIEW, expectationGap: "VERY_HIGH", catalystStrength: "VERY_HIGH" },
      }),
    });
    const spcx = assetRow(report, "SPCX");
    assert.ok(spcx.score !== null && spcx.score >= 80, `pre-veto score ${spcx.score}`);
    assert.ok(spcx.vetoes.includes("rr-missing-or-below-min"));
    assert.equal(spcx.action, "PREPARE");
    assert.notEqual(spcx.state, "TRIGGERED");
    assert.notEqual(report.decision.action, "ENTER");
  });

  it("06-full-trigger: all gates pass and the stop/target map onto the inverse tool", async () => {
    const closes = [105, 100.3, 100.5, 100.4, 100.6, 100.5, 100.2, 100.4, 100.3, 100.5, 100.2, 100.4, 100.1, 100.3, 100.0, 100.2, 100.0, 100.1, 99.9, 100.0, 99.8];
    const { report } = await replayFixture({
      id: "06-full-trigger",
      items: [bearishCompanyEvidence(), bearishCatalystEvidence(), bearishRatesEvidence(), toolClose("SPCX", "SSPC", 50)],
      assetPacks: { SPCX: { bars: barSeries(closes, 1.5), stale: false, session: SESSION, dataConflict: false } },
      model: modelFor({ SPCX: SPX_TRIGGER_VIEW }),
    });
    const spcx = assetRow(report, "SPCX");
    assert.equal(spcx.state, "TRIGGERED");
    assert.equal(spcx.action, "ENTER");
    assert.equal(spcx.executionTool, "SSPC");
    assert.ok(spcx.rr !== null && spcx.rr >= 2);
    assert.ok(spcx.stop && spcx.exit && spcx.toolStop && spcx.toolTarget);
    assert.ok(Math.abs(Number(spcx.toolStop) - 47.6954) < 0.01);
    assert.ok(Math.abs(Number(spcx.toolTarget) - 56.012) < 0.01);
    assert.equal(report.decision.action, "ENTER");
    assert.equal(report.decision.bestOpportunity, "SPCX");
    assert.equal(report.position, "FLAT");
  });

  it("07-flat-rejects-reduce: FLAT never yields a risk-off action even when the narrative suggests it", async () => {
    const { report } = await replayFixture({
      id: "07-flat-rejects-reduce",
      items: [bearishCompanyEvidence()],
      model: modelFor({ SPCX: { consensus: "reject the rebound; reduce risk, consider trimming the position on strength" } }),
    });
    assert.equal(report.position, "FLAT");
    for (const row of report.decision.assets) {
      assert.ok(["WAIT", "PREPARE", "ENTER"].includes(row.action as string));
    }
    assert.equal(report.decision.action, "WAIT");
    assert.match(report.modelOutput?.assets.SPCX.consensus ?? "", /reduce/);
  });

  it("02-full-close: a closed session renders the fixed verdict even with a hot model", async () => {
    const { report } = await replayFixture({
      id: "02-full-close",
      items: [bearishCompanyEvidence(), bearishCatalystEvidence(), bearishRatesEvidence()],
      model: modelFor({ SPCX: SPX_TRIGGER_VIEW }),
    });
    assert.equal(report.overnight_snapshot, true);
    assert.equal(report.dataCutoff.usFreshness, "closed");
    const spcx = assetRow(report, "SPCX");
    assert.equal(spcx.state, "WATCH");
    assert.equal(spcx.action, "WAIT");
    assert.equal(spcx.score, null);
    assert.ok(spcx.vetoes.includes("closed-session"));
    assert.equal(spcx.reason, "us-market-closed-fixed-verdict");
    assert.equal(report.decision.action, "WAIT");
    assert.equal(report.modelOutput?.assets.SPCX.fundamentalShift, "VERY_HIGH");
  });

  it("03-early-close: liquidity weight is dampened and no premature trigger survives", async () => {
    const closes = [105, 100.3, 100.5, 100.4, 100.6, 100.5, 100.2, 100.4, 100.3, 100.5, 100.2, 100.4, 100.1, 100.3, 100.0, 100.2, 100.0, 100.1, 99.9, 100.0, 99.8];
    const { report } = await replayFixture({
      id: "03-early-close",
      items: [bearishCompanyEvidence(), bearishCatalystEvidence(), bearishRatesEvidence(), toolClose("SPCX", "SSPC", 50, "2026-11-27")],
      assetPacks: { SPCX: { bars: barSeries(closes, 1.5, "2026-11-27"), stale: false, session: "2026-11-27", dataConflict: false } },
      model: modelFor({ SPCX: SPX_TRIGGER_VIEW }),
    });
    assert.equal(report.dataCutoff.usFreshness, "early-close");
    const spcx = assetRow(report, "SPCX");
    assert.equal(spcx.priceConfirmation, "HIGH");
    assert.equal(spcx.state, "CONFIRMING");
    assert.equal(spcx.action, "PREPARE");
    assert.notEqual(report.decision.action, "ENTER");
  });
});
