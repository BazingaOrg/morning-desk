import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DeepSeekConfigError,
  DeepSeekHttpError,
  deepseekChat,
  type DeepSeekUsage,
} from "./deepseek";
import { parseDeepSeekOutput } from "../short-monitor/schema";
import type {
  DeepSeekAssetMap,
  DeepSeekOutput,
  EvidenceItem,
} from "../short-monitor/types";

const ASSET_IDS = ["SPCX", "SNDK", "NASDAQ", "GOLD"] as const;

const ASSET_THESIS_FILES = [
  "spcx.md",
  "sndk.md",
  "nasdaq.md",
  "gold.md",
] as const;

const OUTPUT_CONSTRAINT =
  "Output ONLY JSON with exactly the structure shown in OUTPUT JSON EXAMPLE. The example values are illustrative: do not copy its evidence IDs unless they exist in the provided evidence packet. Forbidden keys: score, subscore, priceConfirmation, action, state, positionSize. Every evidenceIds entry MUST be from the provided list.";
export const ANALYST_PROMPT_VERSION = 2;

function promptsRoot(): string {
  return path.join(process.cwd(), "prompts", "short-monitor");
}

function readPromptFile(filePath: string): string {
  const body = readFileSync(filePath, "utf8").trim();
  if (!body) throw new Error(`required prompt is empty: ${filePath}`);
  return body;
}

export function buildAnalystSystemPrompt(): string {
  const root = promptsRoot();
  const parts: string[] = [];
  const policy = readPromptFile(path.join(root, "policy.md"));
  parts.push(policy);

  const assetsDir = path.join(root, "assets");
  for (const name of ASSET_THESIS_FILES) {
    const body = readPromptFile(path.join(assetsDir, name));
    parts.push(body);
  }

  parts.push(OUTPUT_CONSTRAINT);
  parts.push(
    `OUTPUT JSON EXAMPLE\n${readPromptFile(path.join(root, "output-example.json"))}`,
  );
  return parts.join("\n\n");
}

export function sanitizeAnalystOutput(
  raw: unknown,
  evidence: EvidenceItem[],
): DeepSeekOutput | null {
  const parsed = parseDeepSeekOutput(raw);
  if (!parsed || parsed.schemaVersion !== 1) return null;

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const assets = {} as DeepSeekAssetMap;
  let present = 0;

  for (const id of ASSET_IDS) {
    const asset = parsed.assets[id];
    if (!asset) continue;
    const referenced = asset.evidenceIds.map((evidenceId) => evidenceById.get(evidenceId));
    if (referenced.some((item) => !item)) return null;
    if (
      referenced.some(
        (item) =>
          item &&
          item.asset !== id &&
          (item.asset !== "MACRO" || !item.relevantAssets.includes(id)),
      )
    ) {
      return null;
    }
    const changesThesis =
      asset.fundamentalShift !== "NONE" ||
      asset.expectationGap !== "NONE" ||
      asset.catalystStrength !== "NONE" ||
      asset.evidenceConfidence !== "NONE";
    if (changesThesis && referenced.length === 0) return null;
    present += 1;
    assets[id] = asset;
  }

  if (present < 4) return null;

  return {
    schemaVersion: parsed.schemaVersion,
    assets,
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
  };
}

function defaultModelName(): string {
  return process.env.DEEPSEEK_MODEL || "deepseek-chat";
}

export async function analyzeShortMonitor(input: {
  evidence: EvidenceItem[];
  evidenceJson: string;
  chat?: typeof deepseekChat;
}): Promise<{
  output: DeepSeekOutput | null;
  model: string;
  usage?: DeepSeekUsage;
  error?: string;
  attempts: number;
  promptHash: string;
  promptVersion: number;
}> {
  let system: string;
  try {
    system = buildAnalystSystemPrompt();
  } catch (err) {
    return {
      output: null,
      model: defaultModelName(),
      error: err instanceof Error ? err.message : "failed to build system prompt",
      attempts: 0,
      promptHash: "unavailable",
      promptVersion: ANALYST_PROMPT_VERSION,
    };
  }
  const promptHash = createHash("sha256").update(system).digest("hex");
  const chat = input.chat ?? deepseekChat;

  let attempts = 0;
  let lastError = "invalid DeepSeek output";
  let lastModel = defaultModelName();
  let lastUsage: DeepSeekUsage | undefined;

  for (let i = 0; i < 2; i++) {
    attempts += 1;
    try {
      const result = await chat({
        system,
        user: input.evidenceJson,
      });
      lastModel = result.model;
      lastUsage = result.usage;

      let raw: unknown;
      try {
        raw = JSON.parse(result.text) as unknown;
      } catch {
        lastError = "DeepSeek returned non-JSON content";
        continue;
      }

      const output = sanitizeAnalystOutput(raw, input.evidence);
      if (!output) {
        lastError =
          "DeepSeek output failed schema validation, contained forbidden keys, or lost required assets after evidence filter";
        continue;
      }

      return {
        output,
        model: result.model,
        usage: result.usage,
        attempts,
        promptHash,
        promptVersion: ANALYST_PROMPT_VERSION,
      };
    } catch (err) {
      if (err instanceof DeepSeekConfigError) {
        return {
          output: null,
          model: defaultModelName(),
          error: "DEEPSEEK_API_KEY unset",
          attempts: 0,
          promptHash,
          promptVersion: ANALYST_PROMPT_VERSION,
        };
      }
      if (err instanceof DeepSeekHttpError) {
        lastError = err.message;
        continue;
      }
      lastError = err instanceof Error ? err.message : "DeepSeek request failed";
    }
  }

  return {
    output: null,
    model: lastModel,
    usage: lastUsage,
    error: lastError,
    attempts,
    promptHash,
    promptVersion: ANALYST_PROMPT_VERSION,
  };
}
