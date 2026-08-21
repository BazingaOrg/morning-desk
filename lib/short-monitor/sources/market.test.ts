import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QuoteSnapshot, UniverseItem } from "../../types";
import { loadExecutionTools, loadSecurityMaster } from "../master";
import { executionToolGaps, verifyMarketIdentity } from "./market";

function item(id: string, yahoo: string, identity: string[]): UniverseItem {
  return {
    id,
    display: id,
    name: id,
    yahoo,
    market: "US",
    benchmark: "QQQ",
    group: "空头",
    notes: [],
    identity,
  };
}

function quote(
  yahoo: string,
  longName: string,
  sourceSecurityType: "GP" | "GP-ETF",
): QuoteSnapshot {
  const sourceSymbol = `${yahoo}.${sourceSecurityType === "GP" ? "OQ" : "AM"}`;
  return {
    yahoo,
    symbol: sourceSymbol,
    sourceSymbol,
    shortName: longName,
    longName,
    sourceLongName: longName,
    sourceSecurityType,
    sourceSessionDate: "2026-08-20",
    regularMarketPrice: 100,
    quoteType: sourceSecurityType === "GP-ETF" ? "ETF" : "EQUITY",
  };
}

const REAL_TENCENT_NAMES: Record<string, string> = {
  SPCX: "Space Exploration Technologies Corp.",
  SNDK: "Sandisk Corporation",
  QQQ: "Invesco Qqq Trust Unit Ser 1",
  GLD: "Spdr Gold Trust Gold Shares Npv",
  SSPC: "Leverage Shares 2X Short Spcx Daily Etf",
  SNDQ: "Tradr 2X Short Sndk Daily Etf",
  QID: "Proshares Trust Ultrashort Qqq (Post Rev Split)",
  PSQ: "Proshares Trust Short Qqq Post Rev Split",
  GLL: "Proshares Ultrashort Gold",
};

describe("short-monitor market identity", () => {
  it("accepts all four underlyings and five tools against their own contracts", () => {
    const underlyings = loadSecurityMaster().underlyings;
    const tools = loadExecutionTools().tools;
    for (const underlying of underlyings) {
      const sourceType = underlying.kind === "etf" ? "GP-ETF" : "GP";
      assert.equal(
        verifyMarketIdentity(
          item(underlying.id, underlying.yahoo, underlying.identity),
          quote(
            underlying.yahoo,
            REAL_TENCENT_NAMES[underlying.id],
            sourceType,
          ),
          {
            expectedKind: underlying.kind,
            any: underlying.identity,
          },
        ).ok,
        true,
        underlying.id,
      );
    }
    for (const tool of tools) {
      assert.equal(
        verifyMarketIdentity(
          item(tool.id, tool.yahoo, tool.identityAll),
          quote(tool.yahoo, REAL_TENCENT_NAMES[tool.id], "GP-ETF"),
          {
            expectedKind: "etf",
            all: tool.identityAll,
            none: tool.identityNone,
          },
        ).ok,
        true,
        tool.id,
      );
    }
  });

  it("rejects each missing raw Tencent identity field", () => {
    const valid = quote("SNDK", REAL_TENCENT_NAMES.SNDK, "GP");
    for (const field of [
      "sourceSymbol",
      "sourceLongName",
      "sourceSecurityType",
    ] as const) {
      const incomplete = { ...valid };
      delete incomplete[field];
      assert.equal(
        verifyMarketIdentity(
          item("SNDK", "SNDK", ["Sandisk"]),
          incomplete,
          { expectedKind: "equity", any: ["Sandisk"] },
        ).ok,
        false,
        field,
      );
    }
  });

  it("rejects source symbol and security-type conflicts", () => {
    const mismatched = quote("SNDK", REAL_TENCENT_NAMES.SNDK, "GP");
    mismatched.sourceSymbol = "OTHER.OQ";
    assert.equal(
      verifyMarketIdentity(
        item("SNDK", "SNDK", ["Sandisk"]),
        mismatched,
        { expectedKind: "equity", any: ["Sandisk"] },
      ).ok,
      false,
    );
    assert.equal(
      verifyMarketIdentity(
        item("SNDK", "SNDK", ["Sandisk"]),
        quote("SNDK", REAL_TENCENT_NAMES.SNDK, "GP-ETF"),
        { expectedKind: "equity", any: ["Sandisk"] },
      ).ok,
      false,
    );
    assert.equal(
      verifyMarketIdentity(
        item("QQQ", "QQQ", ["Invesco QQQ"]),
        quote("QQQ", REAL_TENCENT_NAMES.QQQ, "GP"),
        { expectedKind: "etf", any: ["Invesco QQQ"] },
      ).ok,
      false,
    );
  });

  it("requires Tencent session and close agreement when price evidence is used", () => {
    const valid = quote("SNDK", REAL_TENCENT_NAMES.SNDK, "GP");
    const contract = {
      expectedKind: "equity" as const,
      any: ["Sandisk"],
      expectedSession: "2026-08-20",
      expectedClose: 100,
    };
    assert.equal(
      verifyMarketIdentity(item("SNDK", "SNDK", ["Sandisk"]), valid, contract).ok,
      true,
    );
    assert.equal(
      verifyMarketIdentity(
        item("SNDK", "SNDK", ["Sandisk"]),
        { ...valid, sourceSessionDate: "2026-08-19" },
        contract,
      ).ok,
      false,
    );
    assert.equal(
      verifyMarketIdentity(
        item("SNDK", "SNDK", ["Sandisk"]),
        { ...valid, regularMarketPrice: 80 },
        contract,
      ).ok,
      false,
    );
  });

  it("distinguishes PSQ from the 2x QID product", () => {
    const psq = item("PSQ", "PSQ", ["ProShares", "Short", "QQQ"]);
    assert.equal(
      verifyMarketIdentity(
        psq,
        quote("PSQ", REAL_TENCENT_NAMES.PSQ, "GP-ETF"),
        {
          expectedKind: "etf",
          all: ["ProShares", "Short", "QQQ"],
          none: ["UltraShort"],
        },
      ).ok,
      true,
    );
    assert.equal(
      verifyMarketIdentity(
        psq,
        quote("PSQ", REAL_TENCENT_NAMES.QID, "GP-ETF"),
        {
          expectedKind: "etf",
          all: ["ProShares", "Short", "QQQ"],
          none: ["UltraShort"],
        },
      ).ok,
      false,
    );
  });
});

describe("execution-tool fallback", () => {
  it("keeps a failed alternate non-blocking when another tool is verified", () => {
    const gaps = executionToolGaps(
      "NASDAQ",
      "2026-08-20",
      ["identity check failed for execution tool QID"],
      true,
    );
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.blocking, false);
  });

  it("blocks only when the asset has no verified execution tool", () => {
    const gaps = executionToolGaps("NASDAQ", "2026-08-20", ["QID failed", "PSQ failed"], false);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.blocking, true);
  });
});
