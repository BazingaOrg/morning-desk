import type { UniverseItem } from "../types";
import { addCalendarDays } from "../time";
import { fetchHkexFacts } from "./hkex";
import { fetchSecFacts } from "./sec";
import type { FactBundle, FactDoc } from "./types";

export type { FactBundle, FactDoc } from "./types";

export async function collectFacts(input: {
  items: UniverseItem[];
  usSessions: string[];
  hkSessions: string[];
}): Promise<FactBundle> {
  const sourcesUsed: string[] = [];
  const gaps: string[] = [];
  const docs: FactDoc[] = [];

  const hkFrom = input.hkSessions.at(-1)
    ? addCalendarDays(input.hkSessions[input.hkSessions.length - 1]!, -21)
    : "";
  const hkTo = input.hkSessions[0] ?? "";

  const [sec, hk] = await Promise.all([
    fetchSecFacts(input.items, input.usSessions),
    hkFrom && hkTo
      ? fetchHkexFacts(input.items, hkFrom, hkTo)
      : Promise.resolve({ docs: [] as FactDoc[], gap: undefined as string | undefined }),
  ]);

  if (sec.docs.length) sourcesUsed.push("SEC EDGAR submissions");
  if (sec.gap) gaps.push(sec.gap);
  if (!sec.docs.length && !sec.gap && input.usSessions.length) {
    gaps.push("SEC 最近交易日无匹配 8-K/10-Q/6-K 等，或映射缺失");
  }
  docs.push(...sec.docs);

  if (hk.docs.length) sourcesUsed.push("HKEX 披露易标题检索");
  if (hk.gap) gaps.push(hk.gap);
  docs.push(...hk.docs);

  return { docs, sourcesUsed, gaps };
}

export function factsFor(
  docs: FactDoc[],
  id: string,
  sessionDates: string[],
): FactDoc[] {
  const window = new Set(sessionDates);
  return docs.filter((d) => d.id === id && window.has(d.eventDate));
}
