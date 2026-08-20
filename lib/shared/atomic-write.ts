import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function writeFileAtomic(file: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, file);
}

export async function writeFileExclusiveAtomic(
  file: string,
  body: string,
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", flag: "wx" });
  try {
    await fs.link(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}
