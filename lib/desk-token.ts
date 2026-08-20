const KEY = "desk-edit-token";

export function deskToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setDeskToken(v: string): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {}
}

export function deskHeaders(extra?: HeadersInit): HeadersInit {
  const headers = new Headers(extra);
  const token = deskToken();
  if (token) headers.set("x-desk-token", token);
  return headers;
}
