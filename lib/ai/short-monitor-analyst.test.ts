import assert from "node:assert/strict";
import { describe, it } from "node:test";
import example from "../../prompts/short-monitor/output-example.json";
import {
  ANALYST_PROMPT_VERSION,
  analyzeShortMonitor,
  buildAnalystSystemPrompt,
  sanitizeAnalystOutput,
} from "./short-monitor-analyst";
import type { AssetId, EvidenceItem } from "../short-monitor/types";
import { DeepSeekHttpError } from "./deepseek";

function evidence(id: string, asset: AssetId | "MACRO", relevantAssets: AssetId[]): EvidenceItem {
  return {
    id,
    asset,
    kind: "test",
    observedAt: "2026-01-02T01:00:00.000Z",
    sourceTier: 1,
    sourceName: "test",
    sourceUrl: "https://example.com",
    title: id,
    summary: id,
    verified: true,
    stale: false,
    cluster: asset === "MACRO" ? "RATES" : "COMPANY",
    signal: "BEARISH",
    relevantAssets,
    limitations: [],
  };
}

const EXAMPLE_EVIDENCE = [
  evidence("ev-spcx-ir-001", "SPCX", ["SPCX"]),
  evidence("ev-sec-spcx-10q-001", "SPCX", ["SPCX"]),
  evidence("ev-sndk-ir-001", "SNDK", ["SNDK"]),
  evidence("ev-fred-realrate-001", "MACRO", ["NASDAQ"]),
  evidence("ev-treasury-auction-001", "MACRO", ["NASDAQ"]),
  evidence("ev-calendar-fomc-001", "MACRO", ["NASDAQ"]),
  evidence("ev-fred-tips-001", "MACRO", ["GOLD"]),
  evidence("ev-cftc-cot-gold-001", "GOLD", ["GOLD"]),
];

describe("sanitizeAnalystOutput", () => {
  it("embeds the exact output structure in the hashed system prompt", () => {
    const prompt = buildAnalystSystemPrompt();
    assert.match(prompt, /OUTPUT JSON EXAMPLE/);
    assert.match(prompt, /"schemaVersion": 1/);
    assert.match(prompt, /"priceReactionFunction": "NONE"/);
    assert.equal(ANALYST_PROMPT_VERSION, 2);
  });

  it("rejects unknown evidence ids", () => {
    const allowed = EXAMPLE_EVIDENCE.filter((item) => item.id !== "ev-spcx-ir-001");
    assert.equal(sanitizeAnalystOutput(example, allowed), null);
  });

  it("returns null when forbidden action field is present", () => {
    const dirty = {
      ...example,
      assets: {
        ...example.assets,
        SPCX: { ...example.assets.SPCX, action: "ENTER" },
      },
    };
    assert.equal(sanitizeAnalystOutput(dirty, EXAMPLE_EVIDENCE), null);
  });

  it("accepts the valid example when all evidence ids are allowed", () => {
    const out = sanitizeAnalystOutput(example, EXAMPLE_EVIDENCE);
    assert.ok(out);
    assert.equal(out.schemaVersion, 1);
    assert.deepEqual(out.assets.SPCX.evidenceIds, example.assets.SPCX.evidenceIds);
    assert.deepEqual(out.assets.SNDK.evidenceIds, example.assets.SNDK.evidenceIds);
    assert.deepEqual(out.assets.NASDAQ.evidenceIds, example.assets.NASDAQ.evidenceIds);
    assert.deepEqual(out.assets.GOLD.evidenceIds, example.assets.GOLD.evidenceIds);
  });

  it("rejects cross-asset evidence references", () => {
    const crossAsset = EXAMPLE_EVIDENCE.map((item) =>
      item.id === "ev-spcx-ir-001" ? { ...item, asset: "SNDK" as const } : item,
    );
    assert.equal(sanitizeAnalystOutput(example, crossAsset), null);
  });
});

describe("analyzeShortMonitor retry boundary", () => {
  it("retries one transient HTTP failure and returns validated output", async () => {
    let calls = 0;
    const result = await analyzeShortMonitor({
      evidence: EXAMPLE_EVIDENCE,
      evidenceJson: JSON.stringify(EXAMPLE_EVIDENCE),
      chat: async () => {
        calls += 1;
        if (calls === 1) throw new DeepSeekHttpError("DeepSeek HTTP 429", 429);
        return {
          text: JSON.stringify(example),
          model: "deepseek-chat",
        };
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.attempts, 2);
    assert.ok(result.output);
    assert.match(result.promptHash, /^[a-f0-9]{64}$/);
  });

  it("fails closed after two timeout errors", async () => {
    let calls = 0;
    const result = await analyzeShortMonitor({
      evidence: EXAMPLE_EVIDENCE,
      evidenceJson: JSON.stringify(EXAMPLE_EVIDENCE),
      chat: async () => {
        calls += 1;
        throw new DeepSeekHttpError("The operation was aborted");
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.output, null);
    assert.equal(result.attempts, 2);
    assert.equal(result.error, "The operation was aborted");
  });
});
