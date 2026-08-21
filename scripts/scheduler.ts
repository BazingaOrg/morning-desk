import { runGenerate } from "../lib/generate-job";
import { shouldRunMorning, shouldRunShort } from "../lib/shared/schedule-policy";
import { readDayRun } from "../lib/shared/run-lock";
import { runShortMonitorStub } from "../lib/short-monitor/job";
import { beijingDate } from "../lib/time";

function schedulerNow(): Date {
  const raw = process.env.SCHEDULER_NOW;
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function intervalMs(): number {
  const raw = Number(process.env.SCHEDULER_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
}

async function tick(now: Date): Promise<void> {
  const bj = beijingDate(now);
  let morning = await readDayRun("morning", bj);
  const short = await readDayRun("short-monitor", bj);

  if (shouldRunMorning(now, morning)) {
    console.log(`[scheduler] ${bj} run morning`);
    try {
      const report = await runGenerate();
      console.log(
        `[scheduler] morning ok: 美股 ${report.us.label} ｜ 港股 ${report.hk.label}`,
      );
      morning = await readDayRun("morning", bj);
    } catch (error) {
      console.error(
        `[scheduler] morning failed:`,
        error instanceof Error ? error.message : error,
      );
      return;
    }
  }

  if (shouldRunShort(now, morning, short)) {
    console.log(`[scheduler] ${bj} run short-monitor`);
    try {
      const result = await runShortMonitorStub(now);
      console.log(
        `[scheduler] short-monitor ${result.status}: ${result.reason}`,
      );
    } catch (error) {
      console.error(
        `[scheduler] short-monitor failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

async function main(): Promise<void> {
  process.env.TZ = process.env.TZ || "Asia/Shanghai";
  const ms = intervalMs();
  console.log(`[scheduler] started interval=${ms}ms tz=${process.env.TZ}`);

  for (;;) {
    try {
      await tick(schedulerNow());
    } catch (error) {
      console.error(
        `[scheduler] tick error:`,
        error instanceof Error ? error.message : error,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
