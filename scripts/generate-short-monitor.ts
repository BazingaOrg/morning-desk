import { runShortMonitorStub } from "../lib/short-monitor/pipeline";

async function main() {
  const result = await runShortMonitorStub();
  console.log(
    `short-monitor ${result.status}: ${result.reason} (snapshot ${result.marketSnapshotId})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
