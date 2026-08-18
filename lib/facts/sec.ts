import { promises as fs } from "node:fs";
import path from "node:path";
import { beijingDate } from "../time";
import type { UniverseItem } from "../types";
import { getJson, SEC_UA, sleep } from "./http";
import type { FactDoc } from "./types";

const CACHE = path.join(process.cwd(), "data", "cache", "sec-tickers.json");
const KEEP = new Set(["8-K", "8-K/A", "10-Q", "10-K", "S-1", "S-1/A", "425", "DEFA14A", "6-K", "20-F"]);
const ETF_LIKE = new Set(["VOO", "QQQ", "SNK", "GLL", "XMHQ", "VGT", "SMH", "EWY"]);

type TickerRow = { cik_str: number; ticker: string; title: string };

function secTicker(item: UniverseItem): string {
  if (item.id === "BRK.B") return "BRK-B";
  return item.yahoo.replace(".HK", "");
}

export async function loadTickerCikMap(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let data: Record<string, TickerRow> | null = null;
  try {
    const raw = JSON.parse(await fs.readFile(CACHE, "utf8")) as {
      beijingDate: string;
      rows: TickerRow[];
    };
    if (raw.beijingDate === beijingDate()) {
      for (const row of raw.rows) {
        out.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
      }
      return out;
    }
  } catch {}

  data = await getJson<Record<string, TickerRow>>(
    "https://www.sec.gov/files/company_tickers.json",
    { headers: { "User-Agent": SEC_UA, Accept: "application/json" } },
    20000,
  );
  if (!data) return out;
  const rows = Object.values(data);
  for (const row of rows) {
    out.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0"));
  }
  try {
    await fs.mkdir(path.dirname(CACHE), { recursive: true });
    await fs.writeFile(CACHE, JSON.stringify({ beijingDate: beijingDate(), rows }));
  } catch {}
  return out;
}

function filingUrl(cik: string, accession: string): string {
  const bare = cik.replace(/^0+/, "");
  const acc = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${bare}/${acc}/${accession}-index.htm`;
}

function kindOf(form: string): FactDoc["kind"] | null {
  const f = form.replace("/A", "");
  if (KEEP.has(form) || KEEP.has(f)) return f as FactDoc["kind"];
  return null;
}

export async function fetchSecRecent(
  item: UniverseItem,
  cik: string,
  sessionDates: string[],
): Promise<FactDoc[]> {
  if (ETF_LIKE.has(item.id)) return [];
  const payload = await getJson<{
    filings?: {
      recent?: {
        form?: string[];
        filingDate?: string[];
        items?: string[];
        accessionNumber?: string[];
        primaryDocument?: string[];
      };
    };
  }>(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
    { headers: { "User-Agent": SEC_UA, Accept: "application/json" } },
    12000,
  );
  const recent = payload?.filings?.recent;
  if (!recent?.form?.length) return [];
  const window = new Set(sessionDates);
  const docs: FactDoc[] = [];
  for (let i = 0; i < recent.form.length; i += 1) {
    const form = recent.form[i];
    const kind = kindOf(form);
    if (!kind) continue;
    const date = recent.filingDate?.[i];
    if (!date || !window.has(date)) continue;
    const items = recent.items?.[i] ?? "";
    const acc = recent.accessionNumber?.[i] ?? "";
    docs.push({
      id: item.id,
      kind,
      title: items ? `${form} ${items}` : form,
      eventDate: date,
      href: filingUrl(cik, acc),
      official: true,
    });
  }
  return docs;
}

export async function fetchSecFacts(
  items: UniverseItem[],
  sessionDates: string[],
): Promise<{ docs: FactDoc[]; gap?: string }> {
  if (!sessionDates.length) return { docs: [] };
  const map = await loadTickerCikMap();
  if (!map.size) return { docs: [], gap: "SEC ticker 映射不可达" };
  const docs: FactDoc[] = [];
  let failures = 0;
  for (const item of items) {
    if (item.market !== "US") continue;
    const cik = map.get(secTicker(item).toUpperCase());
    if (!cik) continue;
    try {
      const found = await fetchSecRecent(item, cik, sessionDates);
      docs.push(...found);
    } catch {
      failures += 1;
    }
    await sleep(220);
  }
  return {
    docs,
    gap: failures ? `SEC 个股 filings 失败 ${failures} 次` : undefined,
  };
}
