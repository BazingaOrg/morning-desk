import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readResponseTextLimited } from "./http";

describe("limited HTTP response reader", () => {
  it("rejects a declared oversized response", async () => {
    const response = new Response("small", { headers: { "content-length": "100" } });
    await assert.rejects(() => readResponseTextLimited(response, 10), /size limit/);
  });

  it("rejects a streamed response after it crosses the byte limit", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    }));
    await assert.rejects(() => readResponseTextLimited(response, 10), /size limit/);
  });

  it("decodes a response within the byte limit", async () => {
    const response = new Response("正常");
    assert.equal(await readResponseTextLimited(response, 16), "正常");
  });
});
