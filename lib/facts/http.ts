export const SEC_UA = "HKUSMorningDesk/0.2 contact@localhost";

export async function getText(
  url: string,
  init: RequestInit = {},
  ms = 10000,
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
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
