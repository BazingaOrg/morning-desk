import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  acquireRunLock,
  dayRunKey,
  readDayRun,
  releaseRunLock,
  writeDayRun,
} from "./run-lock";

describe("run-lock", () => {
  let baseDir: string;

  before(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "morning-desk-lock-"));
  });

  after(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("dayRunKey formats pipeline and beijing date", () => {
    assert.equal(dayRunKey("morning", "2026-01-06"), "morning:2026-01-06");
  });

  it("second acquire fails while held; release then acquire works", async () => {
    const id = "morning";
    const key = dayRunKey(id, "2026-03-01");
    const first = await acquireRunLock(id, key, 60_000, baseDir, 0);
    assert.ok(first);
    assert.equal(await acquireRunLock(id, key, 60_000, baseDir, 0), null);
    await releaseRunLock(first);
    const second = await acquireRunLock(id, key, 60_000, baseDir, 0);
    assert.ok(second);
    await releaseRunLock(second);
  });

  it("does not release another owner's lock", async () => {
    const first = await acquireRunLock("morning", "k", 60_000, baseDir, 0);
    assert.ok(first);
    await releaseRunLock({
      pipelineId: "morning",
      token: "not-the-owner",
      runKey: "k",
      baseDir,
    });
    assert.equal(await acquireRunLock("morning", "k2", 60_000, baseDir, 0), null);
    await releaseRunLock(first);
  });

  it("expired lease can be stolen", async () => {
    const id = "morning";
    const resource = path.join(baseDir, "locks", `${id}.resource`);
    const lockDir = `${resource}.lock`;
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({ token: "old-morning" }));
    const stale = new Date(Date.now() - 120_000);
    await fs.utimes(lockDir, stale, stale);
    const stolen = await acquireRunLock(id, "morning:new", 5_000, baseDir, 0);
    assert.ok(stolen);
    await releaseRunLock(stolen);
  });

  it("expired lease takeover has exactly one owner under contention", async () => {
    const resource = path.join(baseDir, "locks", "morning.resource");
    const lockDir = `${resource}.lock`;
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({ token: "old-morning" }));
    const stale = new Date(Date.now() - 120_000);
    await fs.utimes(lockDir, stale, stale);

    const attempts = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        acquireRunLock("morning", `contender-${index}`, 5_000, baseDir, 0),
      ),
    );
    const owners = attempts.filter((handle) => handle !== null);
    assert.equal(owners.length, 1);
    await releaseRunLock(owners[0]);
  });

  it("writeDayRun is readable and atomic rename succeeds", async () => {
    const record = {
      status: "success" as const,
      runId: "run-1",
      finishedAt: new Date().toISOString(),
    };
    await writeDayRun("morning", "2026-01-06", record, baseDir);
    const loaded = await readDayRun("morning", "2026-01-06", baseDir);
    assert.deepEqual(loaded, record);
  });
});
