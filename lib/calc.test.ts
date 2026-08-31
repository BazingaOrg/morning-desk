import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { movementSignals, tagRow } from "./calc";

const base = {
  ret1D: 0,
  excess10D: 0,
  volumeRatio: 1,
  halted: false,
  listed: true,
  identityOk: true,
  material: false,
};

describe("row attention classification", () => {
  it("keeps data quality failures separate from market movement", () => {
    assert.equal(tagRow({ ...base, identityOk: false }), "数据异常");
    assert.equal(tagRow({ ...base, listed: false }), "数据异常");
    assert.equal(tagRow({ ...base, halted: true }), "数据异常");
  });

  it("requires two ordinary triggers or one severe trigger", () => {
    assert.equal(tagRow({ ...base, ret1D: -0.04 }), "正常");
    assert.equal(tagRow({ ...base, ret1D: -0.04, excess10D: -0.06 }), "重点关注");
    assert.equal(tagRow({ ...base, ret1D: -0.06 }), "重点关注");
    assert.equal(tagRow({ ...base, material: true }), "重点关注");
  });

  it("labels corroborated positive movement as clearly stronger", () => {
    assert.equal(tagRow({ ...base, ret1D: 0.04, excess10D: 0.06 }), "明显走强");
    assert.equal(
      tagRow({ ...base, ret1D: 0.04, excess10D: 0.06, volumeRatio: 0.5 }),
      "重点关注",
    );
  });

  it("normalizes movement severity across return, excess, and volume", () => {
    const signals = movementSignals({ ret1D: 0.03, excess10D: 0.1, volumeRatio: 1 });
    assert.equal(signals.triggerCount, 2);
    assert.equal(signals.severe, true);
    assert.equal(signals.severity, 2);
  });
});
