import { allowEdit } from "@/lib/desk-auth";
import { startGenerateIfIdle } from "@/lib/generate-job";
import {
  isAllowedBenchmark,
  proposeUniverseItem,
} from "@/lib/search";
import {
  buildUniversePayload,
  buildUniversePayloadFrom,
  loadLatestReport,
  updateUniverse,
} from "@/lib/store";
import { FileLeaseBusyError } from "@/lib/shared/file-lock";
import { probeQuote } from "@/lib/yahoo";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

class UniverseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function universeError(error: unknown) {
  if (error instanceof UniverseRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof FileLeaseBusyError) {
    return NextResponse.json({ error: "名单正被其它请求修改，请重试" }, { status: 503 });
  }
  return NextResponse.json({ error: "名单更新失败" }, { status: 500 });
}

export async function GET() {
  return NextResponse.json(await buildUniversePayload());
}

export async function POST(request: Request) {
  if (!allowEdit(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "yahoo, market, benchmark required" }, { status: 400 });
  }

  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const yahoo = typeof rec?.yahoo === "string" ? rec.yahoo.trim() : "";
  const market = rec?.market === "US" || rec?.market === "HK" ? rec.market : null;
  const benchmark = typeof rec?.benchmark === "string" ? rec.benchmark.trim() : "";
  const name = typeof rec?.name === "string" ? rec.name.trim() : "";
  const group = typeof rec?.group === "string" ? rec.group.trim() : "";
  const run = rec?.run === true;

  if (!yahoo || !market || !benchmark) {
    return NextResponse.json({ error: "yahoo, market, benchmark required" }, { status: 400 });
  }

  const quote = await probeQuote(yahoo);
  if (!quote) {
    return NextResponse.json({ error: "核验失败，没有报价" }, { status: 404 });
  }

  const proposed = proposeUniverseItem(market, yahoo, name || quote.name);
  const item = {
    ...proposed,
    name: name || proposed.name,
    group: group || proposed.group,
    benchmark,
  };

  let next;
  try {
    next = await updateUniverse((items) => {
      if (items.length >= 80) {
        throw new UniverseRequestError("名单已满（80）", 409);
      }
      if (items.some((current) => current.id === item.id || current.yahoo === item.yahoo)) {
        throw new UniverseRequestError("已在名单中", 409);
      }
      if (!isAllowedBenchmark(benchmark, items)) {
        throw new UniverseRequestError("invalid benchmark", 400);
      }
      return [...items, item];
    });
  } catch (error) {
    return universeError(error);
  }

  let started = false;
  if (run) {
    started = await startGenerateIfIdle((work) => {
      after(work);
    });
  }

  const report = await loadLatestReport();
  return NextResponse.json({
    ...buildUniversePayloadFrom(next, report),
    started,
  });
}

export async function DELETE(request: Request) {
  if (!allowEdit(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const id =
    body && typeof body === "object" && "id" in body && typeof (body as { id: unknown }).id === "string"
      ? (body as { id: string }).id.trim()
      : "";
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const report = await loadLatestReport();
  let next;
  try {
    next = await updateUniverse((items) => {
      const target = items.find((item) => item.id === id);
      if (!target) throw new UniverseRequestError("not found", 404);

      const payload = buildUniversePayloadFrom(items, report);
      const protectedSet = new Set(payload.referencedBenchmarks);
      if (protectedSet.has(id) || protectedSet.has(target.yahoo)) {
        throw new UniverseRequestError("其它证券的主基准，不能移除", 409);
      }
      return items.filter((item) => item.id !== id);
    });
  } catch (error) {
    return universeError(error);
  }
  return NextResponse.json(buildUniversePayloadFrom(next, report));
}
