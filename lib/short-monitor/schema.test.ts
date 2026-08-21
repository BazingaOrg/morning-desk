import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeepSeekOutput, parseDeepSeekOutput } from "./schema";
import example from "../../prompts/short-monitor/output-example.json";

describe("DeepSeek schema", () => {
  it("accepts the frozen output example", () => {
    assert.equal(isDeepSeekOutput(example), true);
    assert.ok(parseDeepSeekOutput(example));
  });

  it("rejects forbidden score/action/state fields instead of stripping them", () => {
    const dirty = {
      ...example,
      assets: {
        ...example.assets,
        SPCX: { ...example.assets.SPCX, action: "ENTER", score: 88 },
      },
    };
    assert.equal(isDeepSeekOutput(dirty), false);
    assert.equal(parseDeepSeekOutput(dirty), null);
  });

  it("rejects unknown fields outside the frozen structure", () => {
    assert.equal(isDeepSeekOutput({ ...example, extra: true }), false);
    assert.equal(
      isDeepSeekOutput({
        ...example,
        assets: {
          ...example.assets,
          SPCX: { ...example.assets.SPCX, confidenceNote: "extra" },
        },
      }),
      false,
    );
  });
});
