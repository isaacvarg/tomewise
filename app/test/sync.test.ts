import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { snapshot, tempDir, writeFiles } from "../../core/test/helpers.ts";
import type { Clock } from "../src/index.ts";
import { EVENTS, startTestApp } from "./harness.ts";

const SUBJECT = "subjects/morse-code";

const run = promisify(execFile);

let realGit = "git";
let gitLog = "";
let originalPath: string | undefined;

beforeAll(async () => {
  realGit = (await run("sh", ["-c", "command -v git"])).stdout.trim();
  const spy = await tempDir();
  gitLog = join(spy, "calls.log");
  await writeFile(gitLog, "");
  await writeFile(join(spy, "git"), `#!/bin/sh\nprintf '%s\\t%s\\n' "$PWD" "$*" >> '${gitLog}'\nexec '${realGit}' "$@"\n`);
  await chmod(join(spy, "git"), 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${spy}:${originalPath}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
});

async function appGitCalls(root: string): Promise<string[]> {
  return (await readFile(gitLog, "utf8"))
    .split("\n")
    .filter((line) => line.startsWith(`${root}\t`))
    .map((line) => line.slice(root.length + 1));
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(realGit, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
  });
  return stdout.trim();
}

async function enableGit(root: string, settings: Record<string, unknown>) {
  const path = join(root, "tomewise.json");
  const config = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...config, git: settings }, null, 2));
}

function fakeClock() {
  let now = Date.parse("2026-11-22T09:00:00Z");
  const timers = new Set<{ ms: number; due: number; tick: () => Promise<unknown> }>();
  const clock: Clock = {
    now: () => new Date(now),
    every(ms, tick) {
      const timer = { ms, due: now + ms, tick };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
  async function advanceMinutes(minutes: number) {
    now += minutes * 60_000;
    const ticks = [];
    for (const timer of timers) {
      while (timer.due <= now) {
        timer.due += timer.ms;
        ticks.push(timer.tick());
      }
    }
    await Promise.all(ticks);
  }
  return { clock, advanceMinutes, timers };
}

async function cloneSeam(settings: Record<string, unknown> = { remote: "origin" }, clock?: Clock) {
  const remote = await mkdtemp(join(tmpdir(), "tomewise-remote-"));
  let agent = "";
  const app = await startTestApp(async (root) => {
    await enableGit(root, settings);
    await git(remote, "init", "--bare", "--quiet", "--initial-branch=main");
    await git(root, "init", "--quiet", "--initial-branch=main");
    await git(root, "add", "-A");
    await git(root, "commit", "--quiet", "-m", "chore: start");
    await git(root, "remote", "add", "origin", remote);
    await git(root, "push", "--quiet", "origin", "main");
    agent = await mkdtemp(join(tmpdir(), "tomewise-agent-"));
    await git(agent, "clone", "--quiet", remote, ".");
  }, undefined, { clock });

  async function agentPushes(files: Record<string, unknown>) {
    await writeFiles(agent, files);
    await git(agent, "add", "-A");
    await git(agent, "commit", "--quiet", "-m", "feat: content");
    await git(agent, "push", "--quiet", "origin", "main");
  }

  return { app, remote, agent, agentPushes, git };
}

async function lessons(app: { get: (path: string) => Promise<{ body: any }> }): Promise<string[]> {
  return (await app.get("/api/subjects/morse-code")).body.lessons;
}

function sessionStart() {
  return { subject: "morse-code", kind: "session.start", ref: "lesson:0001-k-and-m", schemaVersion: 2, data: {} };
}

function poll<T>(read: () => Promise<T>) {
  return expect.poll(read, { timeout: 3000, interval: 25 });
}

describe("git sync", () => {
  it("brings in the agent's content on Sync now", async () => {
    const { app, agentPushes } = await cloneSeam();
    await agentPushes({ [`${SUBJECT}/lessons/0005-e.html`]: "<!doctype html><title>E</title>" });

    const response = await app.send("POST", "/api/sync");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enabled: true, stopped: false, lastError: null });
    await poll(() => lessons(app)).toContain("0005-e");
  });

  it("pulls the agent's content once the pull interval passes", async () => {
    const { clock, advanceMinutes } = fakeClock();
    const { app, agentPushes } = await cloneSeam({ remote: "origin", pullIntervalMinutes: 10 }, clock);
    await agentPushes({ [`${SUBJECT}/lessons/0005-e.html`]: "<!doctype html><title>E</title>" });

    await advanceMinutes(9);
    expect(await lessons(app)).not.toContain("0005-e");
    expect((await app.get("/api/sync")).body.lastPull).toBeNull();

    await advanceMinutes(1);
    expect((await app.get("/api/sync")).body.lastPull).toBe("2026-11-22T09:10:00.000Z");
    await poll(() => lessons(app)).toContain("0005-e");
  });

  it("stops syncing and reports the error when the remote can't be reached", async () => {
    const { clock, advanceMinutes } = fakeClock();
    const { app, remote } = await cloneSeam({ remote: "origin", pullIntervalMinutes: 5 }, clock);
    await rm(remote, { recursive: true });

    const response = await app.send("POST", "/api/sync");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      enabled: true,
      stopped: true,
      lastPull: null,
      lastError: { at: "2026-11-22T09:00:00.000Z", message: expect.stringContaining("git pull") },
    });
    expect((await app.get("/api/sync")).body).toEqual(response.body);

    await advanceMinutes(5);
    expect((await app.get("/api/sync")).body).toEqual(response.body);
    expect((await app.send("POST", "/api/sync")).status).toBe(409);
  });

  it("stops on a conflict and puts the app's clone back as it was", async () => {
    const { app, agentPushes, remote } = await cloneSeam();
    const notes = `${SUBJECT}/notes.md`;
    await writeFiles(app.root, { [notes]: "server edit\n" });
    await git(app.root, "add", "-A");
    await git(app.root, "commit", "--quiet", "-m", "server edit");
    expect((await app.post(sessionStart())).status).toBe(201);
    const written = await snapshotEvents(app.root);
    await agentPushes({ [notes]: "agent edit\n" });
    const appHead = await git(app.root, "rev-parse", "HEAD");
    const remoteHead = await git(remote, "rev-parse", "main");

    const response = await app.send("POST", "/api/sync");

    expect(response.body).toMatchObject({ stopped: true, lastError: { message: expect.stringContaining("git pull") } });
    expect(await git(app.root, "rev-parse", "HEAD")).toBe(appHead);
    expect(await git(app.root, "status", "--porcelain", "--untracked-files=no")).toMatch(/^M subjects\/morse-code\/events\//);
    expect(await snapshotEvents(app.root)).toEqual(written);
    expect(await readFile(join(app.root, notes), "utf8")).toBe("server edit\n");
    expect(await git(remote, "rev-parse", "main")).toBe(remoteHead);
  });

  it("won't pull over a rebase someone else left in progress", async () => {
    const { app } = await cloneSeam();
    await mkdir(join(app.root, ".git", "rebase-merge"));

    const response = await app.send("POST", "/api/sync");

    expect(response.body).toMatchObject({ stopped: true, lastError: { message: expect.stringContaining("rebase") } });
    expect(await appGitCalls(app.root)).not.toContainEqual(expect.stringMatching(/^(pull|rebase)\b/));
  });

  it("won't pull into a branch other than the configured one", async () => {
    const { app } = await cloneSeam({ remote: "origin", branch: "study" });

    const response = await app.send("POST", "/api/sync");

    expect(response.body).toMatchObject({ stopped: true, lastError: { message: expect.stringContaining('"study"') } });
    expect(await appGitCalls(app.root)).not.toContainEqual(expect.stringMatching(/^pull\b/));
  });

  it("keeps the events the app wrote when it pulls", async () => {
    const { app, agentPushes } = await cloneSeam();
    expect((await app.post(sessionStart())).status).toBe(201);
    const written = await snapshotEvents(app.root);
    await agentPushes({ [`${SUBJECT}/lessons/0005-e.html`]: "<!doctype html><title>E</title>" });

    const response = await app.send("POST", "/api/sync");

    expect(response.body).toMatchObject({ stopped: false, lastError: null });
    expect(await snapshotEvents(app.root)).toEqual(written);
    await poll(() => lessons(app)).toContain("0005-e");
  });

  it("never forces or resets", async () => {
    const { app, remote } = await cloneSeam();
    await app.send("POST", "/api/sync");
    await rm(remote, { recursive: true });
    await app.send("POST", "/api/sync");

    const calls = await appGitCalls(app.root);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toMatch(/\breset\b|--force|\bclean\b|\bcheckout\b|-f\b/);
  });

  it("runs no git with sync off and says so", async () => {
    const { clock, advanceMinutes, timers } = fakeClock();
    const { app } = await cloneSeam({ enabled: false, remote: "origin" }, clock);

    expect((await app.get("/api/sync")).body).toEqual({ enabled: false, stopped: false, lastPull: null, lastError: null });
    expect((await app.send("POST", "/api/sync")).status).toBe(409);
    await advanceMinutes(60);
    expect(timers.size).toBe(0);
    expect(await appGitCalls(app.root)).toEqual([]);
  });
});

async function snapshotEvents(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(await snapshot(root))) if (path.startsWith(EVENTS)) files[path] = content;
  return files;
}
