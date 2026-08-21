export const SEC_UA = "HKUSMorningDesk/0.2 contact@localhost";
export const HTTP_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

export async function readResponseTextLimited(
  response: Response,
  maxBytes = HTTP_RESPONSE_MAX_BYTES,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("response exceeds size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("response exceeds size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function getText(
  url: string,
  init: RequestInit = {},
  ms = 10000,
  maxBytes = HTTP_RESPONSE_MAX_BYTES,
): Promise<{ ok: boolean; status: number; text: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      cache: "no-store",
    });
    const text = await readResponseTextLimited(res, maxBytes);
    return { ok: res.ok, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T>(
  url: string,
  init: RequestInit = {},
  ms = 10000,
): Promise<T | null> {
  const res = await getText(url, init, ms);
  if (!res.ok || !res.text || res.text.trim().startsWith("<")) return null;
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
