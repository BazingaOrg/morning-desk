import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchText, normalizeTencentQuoteType } from "./yahoo";

describe("Tencent quote type normalization", () => {
  it("recognizes Tencent HK stock type zero without weakening US checks", () => {
    assert.equal(normalizeTencentQuoteType("HK", "0"), "EQUITY");
    assert.equal(normalizeTencentQuoteType("US", "0"), "NONE");
    assert.equal(normalizeTencentQuoteType("US", "GP"), "EQUITY");
    assert.equal(normalizeTencentQuoteType("US", "GP-ETF"), "ETF");
  });
});

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
