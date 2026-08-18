import { generateReport } from "../lib/report";

generateReport()
  .then((report) => {
    console.log(report.title);
    console.log(`美股 ${report.us.label} ｜ 港股 ${report.hk.label}`);
    if (report.closedBoth) console.log(report.closedNote);
    else report.conclusion.forEach((line) => console.log(line));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
