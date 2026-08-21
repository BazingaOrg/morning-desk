import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchAdjustedUsSeries, fetchText } from "./yahoo";

describe("market data HTTP boundaries", () => {
  it("applies its headers, no-store policy, and abort signal", async () => {
    let init: RequestInit | undefined;
    const fetchImpl = (async (_url: string | URL | Request, requestInit?: RequestInit) => {
      init = requestInit;
      return new Response("ok");
    }) as typeof fetch;

    await fetchText("https://example.test/quotes?token=secret", { fetchImpl });

    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("user-agent")?.startsWith("Mozilla/5.0"), true);
  });

  it("aborts a request that does not complete before the deadline", async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")));
      })) as typeof fetch;

    await assert.rejects(
      () => fetchText("https://example.test/quotes?token=secret", { fetchImpl, timeoutMs: 1 }),
      /Market data request timed out/,
    );
  });

  it("rejects oversized responses before reading the body", async () => {
    const fetchImpl = (async () =>
      new Response("too large", { headers: { "content-length": "9" } })) as typeof fetch;

    await assert.rejects(
      () => fetchText("https://example.test/quotes?token=secret", { fetchImpl, maxBytes: 8 }),
      /size limit/,
    );
  });

  it("stops reading a streamed response once it exceeds the limit", async () => {
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(9));
            controller.close();
          },
        }),
      )) as typeof fetch;

    await assert.rejects(
      () => fetchText("https://example.test/quotes?token=secret", { fetchImpl, maxBytes: 8 }),
      /size limit/,
    );
  });

  it("does not include request URLs in transport failures", async () => {
    const fetchImpl = (async () => {
      throw new Error("connect https://example.test/quotes?token=secret failed");
    }) as typeof fetch;

    await assert.rejects(
      () => fetchText("https://example.test/quotes?token=secret", { fetchImpl }),
      (error: Error) => {
        assert.equal(error.message, "Market data request failed");
        return true;
      },
    );
  });
});

describe("adjusted US series", () => {
  it("uses adjusted close and applies the adjustment factor to OHLC", async () => {
    const payload = {
      chart: {
        result: [{
          timestamp: [Date.parse("2026-08-20T20:00:00Z") / 1000],
          indicators: {
            quote: [{ open: [100], high: [110], low: [90], close: [100], volume: [1000] }],
            adjclose: [{ adjclose: [50] }],
          },
          events: {},
        }],
        error: null,
      },
    };
    const result = await fetchAdjustedUsSeries("TEST", {
      fetchImpl: async () => new Response(JSON.stringify(payload)),
    });
    assert.deepEqual(result.bars[0], {
      date: "2026-08-20",
      open: 50,
      high: 55,
      low: 45,
      close: 50,
      adjClose: 50,
      volume: 1000,
    });
  });
});
