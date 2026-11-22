import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import type { GitSettings } from "@tomewise/core";

export interface Clock {
  now: () => Date;
  every: (ms: number, tick: () => Promise<unknown>) => () => void;
}

export const systemClock: Clock = {
  now: () => new Date(),
  every(ms, tick) {
    const timer = setInterval(() => void tick(), ms);
    timer.unref();
    return () => clearInterval(timer);
  },
};

export interface SyncStatus {
  enabled: boolean;
  stopped: boolean;
  lastPull: string | null;
  lastError: { at: string; message: string } | null;
}

export type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;

export interface GitSync {
  status: () => SyncStatus;
  syncNow: () => Promise<SyncStatus>;
  exclusive: Exclusive;
  close: () => Promise<void>;
}

const GIT_TIMEOUT_MS = 120_000;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout.trim());
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return reject(new Error("git isn't installed or isn't on PATH"));
        }
        reject(new Error(`git ${args.join(" ")}: ${stderr.trim() || error.message}`));
      },
    );
  });
}

export const syncOff: GitSync = {
  status: () => ({ enabled: false, stopped: false, lastPull: null, lastError: null }),
  syncNow: async () => syncOff.status(),
  exclusive: (work) => work(),
  close: async () => {},
};

export function startSync(root: string, settings: GitSettings, { clock = systemClock }: { clock?: Clock } = {}): GitSync {
  if (!settings.enabled) return syncOff;
  const state: SyncStatus = { enabled: true, stopped: false, lastPull: null, lastError: null };
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }

  async function branch(): Promise<string> {
    const current = await git(root, ["symbolic-ref", "--short", "HEAD"]);
    if (settings.branch !== undefined && settings.branch !== current) {
      throw new Error(`The learning home is on branch "${current}", not the configured branch "${settings.branch}"`);
    }
    return current;
  }

  async function rebasing(): Promise<boolean> {
    for (const path of ["rebase-merge", "rebase-apply"]) {
      if (existsSync(resolve(root, await git(root, ["rev-parse", "--git-path", path])))) return true;
    }
    return false;
  }

  async function pull(remote: string) {
    if (await rebasing()) throw new Error("A rebase is in progress in the learning home; finish or abort it, then restart the app");
    const target = await branch();
    try {
      await git(root, ["pull", "--rebase", "--autostash", "--quiet", remote, target]);
    } catch (error) {
      if (await rebasing()) await git(root, ["rebase", "--abort"]);
      throw error;
    }
    state.lastPull = clock.now().toISOString();
  }

  function syncNow(): Promise<SyncStatus> {
    return exclusive(async () => {
      if (closed || state.stopped) return status();
      try {
        if (settings.remote !== undefined) await pull(settings.remote);
      } catch (error) {
        state.stopped = true;
        state.lastError = { at: clock.now().toISOString(), message: (error as Error).message };
      }
      return status();
    });
  }

  function status(): SyncStatus {
    return { ...state, lastError: state.lastError && { ...state.lastError } };
  }

  const stopTicking =
    settings.remote === undefined ? () => {} : clock.every(settings.pullIntervalMinutes * 60_000, syncNow);

  return {
    status,
    syncNow,
    exclusive,
    async close() {
      closed = true;
      stopTicking();
      await queue;
    },
  };
}

export function syncRoutes(sync: GitSync): Hono {
  const routes = new Hono();
  routes.get("/", (c) => c.json(sync.status()));
  routes.post("/", async (c) => {
    const before = sync.status();
    if (!before.enabled || before.stopped) return c.json(before, 409);
    return c.json(await sync.syncNow());
  });
  return routes;
}
