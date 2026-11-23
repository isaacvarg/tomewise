import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Hono } from "hono";
import {
  generatedFileGlobs,
  type GitCadence,
  isGeneratedFile,
  isoDate,
  type LearningEvent,
  type LearningHome,
  localDay,
  readEvents,
  regenerateVaultFiles,
} from "@tomewise/core";
import { HISTORY_PREFIX, historyMessage } from "./history.ts";

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
  lastCommit: string | null;
  lastPush: string | null;
  lastError: { at: string; message: string } | null;
}

export type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;

export interface GitSync {
  status: () => SyncStatus;
  syncNow: () => Promise<SyncStatus>;
  recorded: (events: LearningEvent[]) => void;
  exclusive: Exclusive;
  close: () => Promise<void>;
}

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const EVENT_FILES = ":(glob)subjects/*/events/**";
const CADENCE_CHECK_MS = 60_000;
const REJECTED = /\[rejected\]|non-fast-forward|fetch first/;
const AUTH_FAILED = /Permission denied \(|Permission to \S+ denied|Host key verification failed|Authentication failed|could not read (Username|Password)|terminal prompts disabled|returned error: 40[13]/i;

function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } },
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

function paths(output: string): string[] {
  return [...new Set(output.split("\0").filter((path) => path !== ""))];
}

function literal(paths: readonly string[]): string[] {
  return paths.map((path) => `:(literal)${path}`);
}

async function allGenerated(home: LearningHome, paths: readonly string[]): Promise<boolean> {
  return (await Promise.all(paths.map((path) => isGeneratedFile(home, path)))).every(Boolean);
}

function periodOf(cadence: Exclude<GitCadence, "session">, time: Date, timezone: string): string {
  const day = isoDate(localDay(time.getTime(), timezone));
  if (cadence === "daily") return day;
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(time);
  return `${day}T${hour}`;
}

export const syncOff: GitSync = {
  status: () => ({ enabled: false, stopped: false, lastPull: null, lastCommit: null, lastPush: null, lastError: null }),
  syncNow: async () => syncOff.status(),
  recorded: () => {},
  exclusive: (work) => work(),
  close: async () => {},
};

export interface SyncOptions {
  clock?: Clock;
  pulledEvents?: (subjects: string[]) => void;
}

export function startSync(home: () => LearningHome, { clock = systemClock, pulledEvents = () => {} }: SyncOptions = {}): GitSync {
  const { root, config } = home();
  const settings = config.git;
  if (!settings.enabled) return syncOff;
  const state: SyncStatus = { enabled: true, stopped: false, lastPull: null, lastCommit: null, lastPush: null, lastError: null };
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

  async function checkedBranch(): Promise<string> {
    if (await rebasing()) throw new Error("A rebase is in progress in the learning home; finish or abort it, then sync again");
    return branch();
  }

  async function push(remote: string, target: string) {
    try {
      await git(root, ["push", "--quiet", remote, `HEAD:refs/heads/${target}`]);
    } catch (error) {
      const message = (error as Error).message;
      if (REJECTED.test(message)) {
        throw new Error(
          `"${remote}/${target}" has diverged from the learning home, so git rejected the push; the app never force-pushes. Pull and push by hand, then sync again. ${message}`,
        );
      }
      if (AUTH_FAILED.test(message)) {
        throw new Error(`Git couldn't sign in to "${remote}"; check the app's git credentials, then sync again. ${message}`);
      }
      throw error;
    }
    state.lastPush = clock.now().toISOString();
  }

  async function pushPending(remote: string, target: string) {
    if (!settings.push) return;
    const unpushed = (await git(root, ["log", "--format=%s", "FETCH_HEAD..HEAD"])).split("\n").filter((line) => line !== "");
    if (unpushed.length === 0) return;
    const others = unpushed.filter((line) => !line.startsWith(HISTORY_PREFIX));
    if (others.length > 0) {
      throw new Error(
        `The learning home has commits the app didn't make that aren't on "${remote}" yet (${others.map((line) => JSON.stringify(line)).join(", ")}); the app only pushes its own history. Push or drop them by hand, then sync again.`,
      );
    }
    await push(remote, target);
  }

  async function pull(remote: string): Promise<string> {
    const target = await checkedBranch();
    const before = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => undefined);
    const setAside = new Set(await setAsideGenerated(before !== undefined));
    try {
      await git(root, ["pull", "--rebase", "--autostash", "--quiet", remote, target]);
    } catch (error) {
      const resolved = (await rebasing()) ? await resolveGeneratedConflicts().catch(() => undefined) : undefined;
      if (resolved === undefined) {
        if (await rebasing()) await git(root, ["rebase", "--abort"]);
        await regenerateVaultFiles(home(), setAside);
        throw error;
      }
      for (const path of resolved) setAside.add(path);
    }
    await regenerateVaultFiles(home(), setAside);
    state.lastPull = clock.now().toISOString();
    const pulled = await git(
      root,
      before === undefined ? ["ls-files", "--", EVENT_FILES] : ["diff", "--name-only", "--no-renames", before, "HEAD", "--", EVENT_FILES],
    );
    const subjects = new Set(pulled.split("\n").filter((path) => path !== "").map((path) => path.split("/")[1]!));
    if (subjects.size > 0) pulledEvents([...subjects]);
    return target;
  }

  async function addedEvents(): Promise<LearningEvent[]> {
    const diff = await git(root, ["diff", "--cached", "--no-color", "--no-ext-diff", "--no-textconv", "--unified=0", "--", EVENT_FILES]);
    const ids = new Map<string, Set<string>>();
    for (const line of diff.split("\n")) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const { id, subject } = JSON.parse(line.slice(1)) as { id: string; subject: string };
      ids.set(subject, (ids.get(subject) ?? new Set()).add(id));
    }
    const added: LearningEvent[] = [];
    for (const [subject, wanted] of ids) {
      added.push(...(await readEvents(home(), subject)).filter((event) => wanted.has(event.id)));
    }
    return added;
  }

  function generatedGlobs(current: LearningHome): string[] {
    return generatedFileGlobs(current).map((glob) => `:(glob)${glob}`);
  }

  async function generatedChanges(): Promise<{ untracked: string[]; tracked: string[] }> {
    const current = home();
    if (!current.config.vault.enabled) return { untracked: [], tracked: [] };
    const globs = generatedGlobs(current);
    const untracked = paths(await git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...globs]));
    const modified = await git(root, ["ls-files", "--modified", "-z", "--", ...globs]);
    const staged = await git(root, ["diff", "--cached", "--name-only", "--no-renames", "-z", "--", ...globs]);
    const tracked = paths(`${modified}\0${staged}`);
    const keep = async (list: string[]) => {
      const generated = await Promise.all(list.map((path) => isGeneratedFile(current, path)));
      return list.filter((_, index) => generated[index]);
    };
    return { untracked: await keep(untracked), tracked: await keep(tracked) };
  }

  async function generatedPathspecs(): Promise<string[]> {
    const { untracked, tracked } = await generatedChanges();
    return literal([...untracked, ...tracked]);
  }

  async function setAsideGenerated(hasHead: boolean): Promise<string[]> {
    const { untracked, tracked } = await generatedChanges();
    const restorable = hasHead ? tracked : [];
    if (restorable.length > 0) await git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...literal(restorable)]);
    await Promise.all(untracked.map((path) => rm(resolve(root, path))));
    return [...untracked, ...restorable];
  }

  async function resolveGeneratedConflicts(): Promise<string[] | undefined> {
    const current = home();
    if (!current.config.vault.enabled) return undefined;
    const resolved: string[] = [];
    while (await rebasing()) {
      const unmerged = paths(await git(root, ["diff", "--name-only", "--diff-filter=U", "-z"]));
      const generated = new Set(paths(await git(root, ["diff", "--name-only", "--diff-filter=U", "-z", "--", ...generatedGlobs(current)])));
      if (unmerged.length === 0 || unmerged.some((path) => !generated.has(path))) return undefined;
      for (const side of ["--theirs", "--ours"]) {
        await git(root, ["restore", side, "--", ...literal(unmerged)]);
        if (!(await allGenerated(current, unmerged))) return undefined;
      }
      await git(root, ["add", "--", ...literal(unmerged)]);
      resolved.push(...unmerged);
      const empty = (await git(root, ["diff", "--cached", "--name-only"])) === "";
      await git(root, ["rebase", empty ? "--skip" : "--continue"], { GIT_EDITOR: "true" }).catch(() => {});
    }
    return resolved;
  }

  async function commitHistory() {
    if ((await git(root, ["status", "--porcelain", "--", EVENT_FILES])) === "") return;
    const remote = settings.remote;
    const target = remote === undefined ? await checkedBranch() : await pull(remote);
    const generated = await generatedPathspecs();
    await git(root, ["add", "--all", "--", EVENT_FILES, ...generated]);
    const added = await addedEvents();
    if (added.length === 0) throw new Error("Event files changed without new events; check subjects/*/events/ with git status");
    const message = historyMessage(added, config.timezone);
    await git(root, ["commit", "--quiet", "--only", "--message", message, "--", EVENT_FILES, ...generated]);
    state.lastCommit = clock.now().toISOString();
    if (remote !== undefined) await pushPending(remote, target);
  }

  async function pullContent() {
    const remote = settings.remote;
    if (remote === undefined) return;
    await pushPending(remote, await pull(remote));
  }

  function step(work: () => Promise<void>, { retry = false } = {}): Promise<SyncStatus> {
    return exclusive(async () => {
      if (closed || (state.stopped && !retry)) return status();
      try {
        await work();
        state.stopped = false;
        state.lastError = null;
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

  const syncNow = () => step(pullContent, { retry: true });

  function onTheClock(cadence: Exclude<GitCadence, "session">): () => void {
    let period = periodOf(cadence, clock.now(), config.timezone);
    return clock.every(CADENCE_CHECK_MS, async () => {
      const now = periodOf(cadence, clock.now(), config.timezone);
      if (now === period) return;
      period = now;
      await step(commitHistory);
    });
  }

  function recorded(events: LearningEvent[]) {
    if (settings.cadence === "session" && events.some((event) => event.kind === "session.end")) void step(commitHistory);
  }

  const stopTimers = [
    settings.remote === undefined ? () => {} : clock.every(settings.pullIntervalMinutes * 60_000, () => step(pullContent)),
    settings.cadence === "session" ? () => {} : onTheClock(settings.cadence),
  ];

  return {
    status,
    syncNow,
    recorded,
    exclusive,
    async close() {
      closed = true;
      for (const stop of stopTimers) stop();
      await queue;
    },
  };
}

export function syncRoutes(sync: GitSync): Hono {
  const routes = new Hono();
  routes.get("/", (c) => c.json(sync.status()));
  routes.post("/", async (c) => {
    const before = sync.status();
    if (!before.enabled) return c.json(before, 409);
    return c.json(await sync.syncNow());
  });
  return routes;
}
