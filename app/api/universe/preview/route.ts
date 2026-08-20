import { allowEdit } from "@/lib/desk-auth";
import { proposeUniverseItem, BENCHMARKS } from "@/lib/search";
import { loadUniverse } from "@/lib/store";
import { probeQuote } from "@/lib/yahoo";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!allowEdit(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "yahoo and market required" }, { status: 400 });
  }

  const yahoo =
    body && typeof body === "object" && "yahoo" in body && typeof (body as { yahoo: unknown }).yahoo === "string"
      ? (body as { yahoo: string }).yahoo.trim()
      : "";
  const market =
    body && typeof body === "object" && "market" in body && ((body as { market: unknown }).market === "US" || (body as { market: unknown }).market === "HK")
      ? (body as { market: "US" | "HK" }).market
      : null;

  if (!yahoo || !market) {
    return NextResponse.json({ error: "yahoo and market required" }, { status: 400 });
  }

  const quote = await probeQuote(yahoo);
  if (!quote) {
    return NextResponse.json({ error: "核验失败，没有报价" }, { status: 404 });
  }

  const item = proposeUniverseItem(market, yahoo, quote.name);
  const universe = await loadUniverse();
  const tracked = universe.some((u) => u.id === item.id || u.yahoo === item.yahoo);

  return NextResponse.json({
    item,
    tracked,
    benchmarks: [...BENCHMARKS],
  });
}
