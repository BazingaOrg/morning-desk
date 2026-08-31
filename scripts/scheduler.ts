import { loadLocalEnv } from "../lib/env";
import { runGenerate } from "../lib/generate-job";
import { shouldRunMorning } from "../lib/shared/schedule-policy";
import { readDayRun } from "../lib/shared/run-lock";
import { beijingDate } from "../lib/time";

loadLocalEnv();

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
  const morning = await readDayRun("morning", bj);

  if (shouldRunMorning(now, morning)) {
    console.log(`[scheduler] ${bj} run morning`);
    try {
      const report = await runGenerate();
      console.log(
        `[scheduler] morning ok: 美股 ${report.us.label} ｜ 港股 ${report.hk.label}`,
      );
    } catch (error) {
      console.error(
        `[scheduler] morning failed:`,
        error instanceof Error ? error.message : error,
      );
      return;
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
