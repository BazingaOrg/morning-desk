import { promises as fs } from "node:fs";
import path from "node:path";
import type { UniverseItem } from "../types";
import { getJson, getText, sleep } from "./http";
import type { FactDoc } from "./types";

const ID_CACHE = path.join(process.cwd(), "data", "cache", "hkex-stock-ids.json");
const IGNORE = /翌日披露|月報表|月报表|董事名單|董事名单|翌日表格/;
const RESULT = /業績|业绩|盈利警告|盈利預告|盈利预告|中期業績|年度業績|季度/;
const HALT = /停牌|復牌|复牌|短暫停牌/;
const MATERIAL = /內幕消息|内幕消息|須予公布|须予公布|主要交易|非常重大/;
const BOARD = /董事會會議|董事会会议|Date of Board Meeting|NOTICE OF BOARD MEETING/i;
const MEET = /股東周年大會|股東特別大會|股东大会|股東大會|Notice of AGM|Notice of EGM/i;

type HkRow = {
  TITLE?: string;
  LONG_TEXT?: string;
  DATE_TIME?: string;
  FILE_LINK?: string;
  STOCK_CODE?: string;
};

function code5(item: UniverseItem): string {
  return item.id.padStart(5, "0");
}

function strip(html: string): string {
  return html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseHkDate(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseTitleDate(title: string): string | undefined {
  const cn = title.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cn) {
    return `${cn[1]}-${cn[2].padStart(2, "0")}-${cn[3].padStart(2, "0")}`;
  }
  const iso = title.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const slash = title.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  return undefined;
}

export type HkexPrefixHit = {
  code: string;
  name: string;
  stockId?: number;
};

export async function searchHkexPrefix(query: string): Promise<HkexPrefixHit[]> {
  const name = query.trim();
  if (!name) return [];
  const raw = await getText(
    `https://www1.hkexnews.hk/search/prefix.do?callback=callback&lang=ZH&type=A&name=${encodeURIComponent(name)}&market=SEHK`,
    { headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } },
    10000,
  );
  const m = raw.text.match(/callback\((\{[\s\S]*\})\)/);
  if (!m) return [];
  try {
    const json = JSON.parse(m[1]) as {
      stockInfo?: Array<{ stockId?: number; code?: string; name?: string }>;
    };
    const out: HkexPrefixHit[] = [];
    for (const row of json.stockInfo ?? []) {
      const code = String(row.code ?? "").padStart(5, "0");
      if (!/^\d{5}$/.test(code)) continue;
      out.push({
        code,
        name: String(row.name ?? "").trim() || code,
        stockId: row.stockId,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadHkexIds(items: UniverseItem[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let stored: Record<string, string> = {};
  try {
    stored = JSON.parse(await fs.readFile(ID_CACHE, "utf8")) as Record<string, string>;
  } catch {
    stored = {};
  }
  for (const item of items.filter((i) => i.market === "HK")) {
    const code = code5(item);
    if (stored[code]) {
      out.set(item.id, stored[code]);
      continue;
    }
    const raw = await getText(
      `https://www1.hkexnews.hk/search/prefix.do?callback=callback&lang=ZH&type=A&name=${code}&market=SEHK`,
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } },
      10000,
    );
    const m = raw.text.match(/callback\((\{[\s\S]*\})\)/);
    if (!m) continue;
    try {
      const json = JSON.parse(m[1]) as { stockInfo?: Array<{ stockId: number; code: string }> };
      const hit = json.stockInfo?.find((s) => s.code.padStart(5, "0") === code);
      if (hit) {
        stored[code] = String(hit.stockId);
        out.set(item.id, String(hit.stockId));
      }
    } catch {}
    await sleep(150);
  }
  try {
    await fs.mkdir(path.dirname(ID_CACHE), { recursive: true });
    await fs.writeFile(ID_CACHE, JSON.stringify(stored, null, 2));
  } catch {}
  return out;
}

export async function fetchHkexRecent(
  item: UniverseItem,
  stockId: string,
  fromYmd: string,
  toYmd: string,
): Promise<FactDoc[]> {
  const from = fromYmd.replace(/-/g, "");
  const to = toYmd.replace(/-/g, "");
  const qs = new URLSearchParams({
    sortDir: "0",
    sortByOptions: "DateTime",
    category: "0",
    market: "SEHK",
    stockId,
    documentType: "-1",
    fromDate: from,
    toDate: to,
    title: "",
    searchType: "0",
    t1code: "-2",
    t2Gcode: "-2",
    t2code: "-2",
    rowRange: "40",
    lang: "ZH",
  });
  const payload = await getJson<{ result?: string }>(
    `https://www1.hkexnews.hk/search/titleSearchServlet.do?${qs.toString()}`,
    { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } },
    15000,
  );
  if (!payload?.result) return [];
  let rows: HkRow[] = [];
  try {
    rows = JSON.parse(payload.result) as HkRow[];
  } catch {
    return [];
  }
  const docs: FactDoc[] = [];
  for (const row of rows) {
    const title = strip(`${row.TITLE ?? ""} ${row.LONG_TEXT ?? ""}`);
    if (!title || IGNORE.test(title)) continue;
    const eventDate = parseHkDate(row.DATE_TIME);
    if (!eventDate) continue;
    const href = row.FILE_LINK
      ? `https://www1.hkexnews.hk${row.FILE_LINK}`
      : `https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=ZH&market=SEHK&stockId=${stockId}`;
    let kind: FactDoc["kind"] = "HK公告";
    let catalystDate: string | undefined;
    if (BOARD.test(title)) {
      kind = "董事会会议";
      catalystDate = parseTitleDate(title);
    } else if (MEET.test(title)) {
      kind = "股东大会";
      catalystDate = parseTitleDate(title);
    } else if (!(RESULT.test(title) || HALT.test(title) || MATERIAL.test(title))) {
      continue;
    }
    docs.push({
      id: item.id,
      kind,
      title: title.slice(0, 120),
      eventDate,
      catalystDate,
      href,
      official: true,
    });
  }
  return docs;
}

export async function fetchHkexFacts(
  items: UniverseItem[],
  fromYmd: string,
  toYmd: string,
): Promise<{ docs: FactDoc[]; gap?: string }> {
  const ids = await loadHkexIds(items);
  if (!ids.size) return { docs: [], gap: "HKEX stockId 无法解析" };
  const docs: FactDoc[] = [];
  let failures = 0;
  for (const item of items.filter((i) => i.market === "HK")) {
    const stockId = ids.get(item.id);
    if (!stockId) continue;
    try {
      docs.push(...(await fetchHkexRecent(item, stockId, fromYmd, toYmd)));
    } catch {
      failures += 1;
    }
    await sleep(180);
  }
  return { docs, gap: failures ? `HKEX 公告失败 ${failures} 次` : undefined };
}
