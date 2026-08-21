import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { companyFactEvidence } from "./sec";

describe("SEC companyfacts evidence", () => {
  it("turns a comparable official revenue decline into bearish company evidence", () => {
    const evidence = companyFactEvidence({
      asset: "SNDK",
      cik: "0000000001",
      observedAt: "2026-08-20T01:00:00.000Z",
      cutoff: "2026-08-20",
      payload: {
        facts: {
          "us-gaap": {
            RevenueFromContractWithCustomerExcludingAssessedTax: {
              units: {
                USD: [
                  { fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-08-01", end: "2026-06-30", val: 80 },
                  { fy: 2025, fp: "Q2", form: "10-Q", filed: "2025-08-01", end: "2025-06-30", val: 100 },
                ],
              },
            },
          },
        },
      },
    });
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]?.cluster, "COMPANY");
    assert.equal(evidence[0]?.signal, "BEARISH");
    assert.equal(evidence[0]?.verified, true);
  });

  it("does not invent company evidence without comparable periods", () => {
    const evidence = companyFactEvidence({
      asset: "SPCX",
      cik: "0000000002",
      observedAt: "2026-08-20T01:00:00.000Z",
      cutoff: "2026-08-20",
      payload: { facts: { "us-gaap": {} } },
    });
    assert.deepEqual(evidence, []);
  });
});
