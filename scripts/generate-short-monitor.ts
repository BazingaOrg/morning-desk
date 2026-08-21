import { runShortMonitor } from "../lib/short-monitor/job";

async function main() {
  const result = await runShortMonitor(new Date(), { retryFailed: true });
  console.log(
    `short-monitor ${result.status}: ${result.degradationReason ?? "ok"} (snapshot ${result.marketSnapshotId})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
