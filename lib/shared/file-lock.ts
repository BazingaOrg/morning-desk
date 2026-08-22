import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type RetryOptions = {
  retries: number;
  minTimeout?: number;
  maxTimeout?: number;
  randomize?: boolean;
};

type LeaseOptions = {
  staleMs: number;
  updateMs?: number;
  retries?: number | RetryOptions;
};

type OwnerRecord = {
  token: string;
};

export type FileLease = {
  release: () => Promise<void>;
};

export class FileLeaseBusyError extends Error {}

function lockPath(resource: string): string {
  return `${resource}.lock`;
}

function ownerPath(lockDir: string): string {
  return path.join(lockDir, "owner.json");
}

async function readOwner(lockDir: string): Promise<OwnerRecord | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(ownerPath(lockDir), "utf8")) as {
      token?: unknown;
    };
    return typeof parsed.token === "string" && parsed.token.length > 0
      ? { token: parsed.token }
      : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

function retiredPath(lockDir: string, ownerKey: string): string {
  return `${lockDir}.retired-${ownerKey.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
}

function recoveryClaimPath(lockDir: string, ownerKey: string): string {
  return `${lockDir}.recovery-${ownerKey}`;
}

async function removeRetiredLock(lockDir: string, ownerKey: string): Promise<void> {
  try {
    await fs.rm(retiredPath(lockDir, ownerKey), { recursive: true, force: true });
  } catch {
    // best-effort cleanup of retired lock directories
  }
}

async function claimRecovery(claimPath: string, staleMs: number): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const claim = await fs.open(claimPath, "wx");
      await claim.close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    let stat;
    try {
      stat = await fs.stat(claimPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (!stat.isFile() || Date.now() - stat.mtimeMs < staleMs) return false;
    // A previous recovery crashed after claiming; take the claim over.
    try {
      await fs.unlink(claimPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
  }
  return false;
}

async function retireStaleLock(lockDir: string, staleMs: number): Promise<boolean> {
  const owner = await readOwner(lockDir);
  let stat;
  try {
    stat = await fs.stat(lockDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
  if (Date.now() - stat.mtimeMs < staleMs) return false;

  const ownerKey = owner?.token ?? `orphan-${stat.ino}-${Math.trunc(stat.mtimeMs)}`;
  const claimPath = recoveryClaimPath(lockDir, ownerKey);
  const claimed = !owner && await claimRecovery(claimPath, staleMs);
  if (!owner && !claimed) return false;
  try {
    await fs.rename(lockDir, retiredPath(lockDir, ownerKey));
    await removeRetiredLock(lockDir, ownerKey);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EEXIST" || code === "ENOTEMPTY") {
      return false;
    }
    throw err;
  } finally {
    if (claimed) {
      await fs.unlink(claimPath).catch(() => undefined);
    }
  }
}

async function createLease(
  lockDir: string,
  token: string,
  staleMs: number,
  updateMs: number,
): Promise<FileLease | null> {
  try {
    await fs.mkdir(lockDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw err;
  }

  await fs.writeFile(ownerPath(lockDir), JSON.stringify({ token }), {
    encoding: "utf8",
    flag: "wx",
  });

  let active = true;
  const timer = setInterval(() => {
    void (async () => {
      const owner = await readOwner(lockDir).catch(() => null);
      if (!owner || owner.token !== token) {
        active = false;
        clearInterval(timer);
        return;
      }
      const now = new Date();
      await fs.utimes(lockDir, now, now).catch(() => {
        active = false;
        clearInterval(timer);
      });
    })();
  }, Math.min(updateMs, Math.max(1_000, Math.floor(staleMs / 2))));
  timer.unref?.();

  return {
    async release() {
      if (!active) return;
      active = false;
      clearInterval(timer);
      const owner = await readOwner(lockDir);
      if (!owner || owner.token !== token) return;
      try {
        await fs.rename(lockDir, retiredPath(lockDir, token));
        await removeRetiredLock(lockDir, token);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "EEXIST" && code !== "ENOTEMPTY") {
          throw err;
        }
      }
    },
  };
}

function retrySettings(retries: LeaseOptions["retries"]): {
  attempts: number;
  minTimeout: number;
  maxTimeout: number;
  randomize: boolean;
} {
  if (typeof retries === "number") {
    return { attempts: retries + 1, minTimeout: 10, maxTimeout: 50, randomize: true };
  }
  return {
    attempts: (retries?.retries ?? 0) + 1,
    minTimeout: retries?.minTimeout ?? 10,
    maxTimeout: retries?.maxTimeout ?? 50,
    randomize: retries?.randomize ?? false,
  };
}

function retryDelay(
  attempt: number,
  settings: ReturnType<typeof retrySettings>,
): number {
  const base = Math.min(settings.maxTimeout, settings.minTimeout * 2 ** attempt);
  return settings.randomize ? Math.max(1, Math.floor(base * (0.5 + Math.random()))) : base;
}

export async function acquireFileLease(
  resource: string,
  options: LeaseOptions,
): Promise<FileLease | null> {
  await fs.mkdir(path.dirname(resource), { recursive: true });
  const lockDir = lockPath(resource);
  const token = randomBytes(16).toString("hex");
  const updateMs = options.updateMs ?? Math.floor(options.staleMs / 2);
  const settings = retrySettings(options.retries);

  for (let attempt = 0; attempt < settings.attempts; attempt++) {
    const created = await createLease(lockDir, token, options.staleMs, updateMs);
    if (created) return created;
    if (await retireStaleLock(lockDir, options.staleMs)) {
      const recovered = await createLease(lockDir, token, options.staleMs, updateMs);
      if (recovered) return recovered;
    }
    if (attempt + 1 < settings.attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, settings)));
    }
  }
  return null;
}

export async function withFileLease<T>(
  resource: string,
  work: () => Promise<T>,
  options: LeaseOptions,
): Promise<T> {
  const lease = await acquireFileLease(resource, options);
  if (!lease) throw new FileLeaseBusyError(`resource is busy: ${resource}`);
  try {
    return await work();
  } finally {
    await lease.release();
  }
}
