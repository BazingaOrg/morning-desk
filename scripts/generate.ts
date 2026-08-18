import { generateReport } from "../lib/report";
import { writeJobStatus } from "../lib/store";

async function main() {
  await writeJobStatus({
    state: "running",
    startedAt: new Date().toISOString(),
    message: "正在拉取完整交易日收盘",
  });
  try {
    const report = await generateReport();
    await writeJobStatus({
      state: "ok",
      startedAt: undefined,
      finishedAt: new Date().toISOString(),
      message: `美股 ${report.us.label} ｜ 港股 ${report.hk.label}`,
    });
    console.log(report.title);
    console.log(`美股 ${report.us.label} ｜ 港股 ${report.hk.label}`);
    if (report.closedBoth) console.log(report.closedNote);
    else report.conclusion.forEach((line) => console.log(line));
  } catch (error) {
    await writeJobStatus({
      state: "error",
      finishedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
