import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadLocalEnv(file = path.join(process.cwd(), ".env")): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}
