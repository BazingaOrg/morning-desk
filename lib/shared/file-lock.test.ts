import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { acquireFileLease, withFileLease } from "./file-lock";

describe("file-lock", () => {
  let baseDir: string;

  before(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "morning-desk-file-lock-"));
  });

  after(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("serializes concurrent read-modify-write transactions without lost updates", async () => {
    const resource = path.join(baseDir, "counter.resource");
    const counter = path.join(baseDir, "counter.txt");
    await fs.writeFile(counter, "0", "utf8");

    await Promise.all(
      Array.from({ length: 40 }, () =>
        withFileLease(
          resource,
          async () => {
            const value = Number(await fs.readFile(counter, "utf8"));
            await fs.writeFile(counter, String(value + 1), "utf8");
          },
          {
            staleMs: 5_000,
            updateMs: 1_000,
            retries: {
              retries: 100,
              minTimeout: 1,
              maxTimeout: 5,
              randomize: true,
            },
          },
        ),
      ),
    );

    assert.equal(await fs.readFile(counter, "utf8"), "40");
  });

  it("recovers a stale ownerless lock even when a crashed recovery claim lingers", async () => {
    const resource = path.join(baseDir, "orphan.resource");
    const lockDir = `${resource}.lock`;
    await fs.mkdir(lockDir, { recursive: true });
    const stale = new Date(Date.now() - 120_000);
    await fs.utimes(lockDir, stale, stale);
    const stat = await fs.stat(lockDir);
    const claimPath = `${lockDir}.recovery-orphan-${stat.ino}-${Math.trunc(stat.mtimeMs)}`;
    await fs.writeFile(claimPath, "", "utf8");
    await fs.utimes(claimPath, stale, stale);

    const lease = await acquireFileLease(resource, {
      staleMs: 5_000,
      retries: { retries: 5, minTimeout: 1, maxTimeout: 5 },
    });
    assert.ok(lease);

    const leftovers = (await fs.readdir(baseDir)).filter(
      (name) => name.includes(".recovery-") || name.includes(".retired-"),
    );
    assert.deepEqual(leftovers, []);
    await lease.release();
  });
});
