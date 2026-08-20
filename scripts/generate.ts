import { runGenerate } from "../lib/generate-job";
import { readDayRun } from "../lib/shared/run-lock";
import { beijingDate } from "../lib/time";

async function main() {
  const bj = beijingDate();
  if (process.env.FORCE_GENERATE !== "1") {
    const existing = await readDayRun("morning", bj);
    if (existing?.status === "success") {
      console.log("morning already success today, skip");
      return;
    }
  }

  try {
    const report = await runGenerate();
    console.log(report.title);
    console.log(`美股 ${report.us.label} ｜ 港股 ${report.hk.label}`);
    if (report.closedBoth) console.log(report.closedNote);
    else report.conclusion.forEach((line) => console.log(line));
  } catch (error) {
    if (error instanceof Error && error.message === "generate already running") {
      console.log("generate already running, skip");
      return;
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
