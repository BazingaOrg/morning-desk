import { searchUniverse } from "@/lib/search";
import type { SearchScope } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseScope(value: string | null): SearchScope {
  if (value === "tracked" || value === "us" || value === "hk" || value === "all") {
    return value;
  }
  return "all";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const scope = parseScope(url.searchParams.get("scope"));
  const result = await searchUniverse(q, scope);
  return NextResponse.json(result);
}
