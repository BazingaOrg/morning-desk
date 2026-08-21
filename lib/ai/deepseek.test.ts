import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeepSeekHttpError, deepseekChat } from "./deepseek";

async function withDeepSeekKey<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
}

describe("deepseek transport", { concurrency: false }, () => {
  it("reports HTTP 429 without parsing the body", async () => {
    await withDeepSeekKey(async () => {
      await assert.rejects(
        () => deepseekChat({
          system: "test",
          user: "test",
          fetcher: async () => new Response("rate limited", { status: 429 }),
        }),
        (error: unknown) =>
          error instanceof DeepSeekHttpError &&
          error.status === 429 &&
          error.message === "DeepSeek HTTP 429",
      );
    });
  });

  it("aborts a request at the configured timeout", async () => {
    await withDeepSeekKey(async () => {
      await assert.rejects(
        () => deepseekChat({
          system: "test",
          user: "test",
          timeoutMs: 5,
          fetcher: async (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            }),
        }),
        (error: unknown) =>
          error instanceof DeepSeekHttpError && /abort/i.test(error.message),
      );
    });
  });
});
