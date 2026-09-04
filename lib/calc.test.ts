import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { movementSignals, rowDisplayName, tagRow } from "./calc";
import type { UniverseItem } from "./types";

function item(partial: Partial<UniverseItem> & Pick<UniverseItem, "market" | "name">): UniverseItem {
  return {
    id: partial.id ?? "X",
    display: partial.display ?? "X",
    yahoo: partial.yahoo ?? "X",
    benchmark: partial.benchmark ?? "VOO",
    group: partial.group ?? "测试",
    notes: partial.notes ?? [],
    identity: partial.identity ?? [],
    ...partial,
  };
}

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

describe("rowDisplayName", () => {
  it("keeps US rows on the maintained English name", () => {
    const us = item({ market: "US", name: "Intuit" });
    assert.equal(rowDisplayName(us, { yahoo: "INTU", symbol: "INTU", shortName: "财捷" }), "Intuit");
    assert.equal(rowDisplayName(us), "Intuit");
  });

  it("prefers the quote name for HK rows", () => {
    const hk = item({ id: "01024", display: "01024.HK", yahoo: "1024.HK", market: "HK", name: "快手-W" });
    assert.equal(
      rowDisplayName(hk, { yahoo: "1024.HK", symbol: "01024", shortName: "快手-W" }),
      "快手-W",
    );
    assert.equal(rowDisplayName(hk), "快手-W");
  });
});
