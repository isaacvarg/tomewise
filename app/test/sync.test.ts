import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
let originalEnv: Record<string, string | undefined> = {};
const ISOLATED_ENV = ["PATH", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_SSH", "GIT_SSH_COMMAND"];

beforeAll(async () => {
  realGit = (await run("sh", ["-c", "command -v git"])).stdout.trim();
  const spy = await tempDir();
  gitLog = join(spy, "calls.log");
  await writeFile(gitLog, "");
  await writeFile(join(spy, "git"), `#!/bin/sh\nprintf '%s\\t%s\\n' "$PWD" "$*" >> '${gitLog}'\nexec '${realGit}' "$@"\n`);
  await chmod(join(spy, "git"), 0o755);
  const globalConfig = join(spy, "gitconfig");
  await writeFile(globalConfig, "[user]\n\tuseConfigOnly = true\n[commit]\n\tgpgsign = false\n");
  originalEnv = Object.fromEntries(ISOLATED_ENV.map((name) => [name, process.env[name]]));
  process.env.PATH = `${spy}:${originalEnv.PATH}`;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  delete process.env.GIT_SSH;
  delete process.env.GIT_SSH_COMMAND;
});

afterAll(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
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

async function cloneSeam(
  settings: Record<string, unknown> = { remote: "origin" },
  clock?: Clock,
  { identity = true }: { identity?: boolean } = {},
) {
  const remote = await mkdtemp(join(tmpdir(), "tomewise-remote-"));
  let agent = "";
  const app = await startTestApp(async (root) => {
    await enableGit(root, settings);
    await git(remote, "init", "--bare", "--quiet", "--initial-branch=main");
    await git(root, "init", "--quiet", "--initial-branch=main");
    if (identity) {
      await git(root, "config", "user.name", "Learner");
      await git(root, "config", "user.email", "learner@example.com");
    }
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

function poll<T>(read: () => T | Promise<T>) {
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
    expect((await appGitCalls(app.root)).filter((call) => /^pull\b/.test(call))).toHaveLength(1);
  });

  it("tries again on Sync now after a failure, and clears the error once it works", async () => {
    const { app, remote } = await cloneSeam();
    const moved = `${remote}-away`;
    await rename(remote, moved);
    expect((await app.send("POST", "/api/sync")).body).toMatchObject({ stopped: true });

    expect((await app.send("POST", "/api/sync")).body).toMatchObject({ stopped: true, lastError: { message: expect.stringContaining("git pull") } });

    await rename(moved, remote);
    const response = await app.send("POST", "/api/sync");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stopped: false, lastPull: expect.any(String), lastError: null });
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

  it("announces the events a pull brings in", async () => {
    const { app, agentPushes } = await cloneSeam();
    const stream = await app.changes();
    const event = { ...sessionStart(), id: "01KAJ0000000000000000PHONE", ts: "2026-11-22T08:00:00.000Z" };
    await agentPushes({ [`${EVENTS}/2026-11.phone.jsonl`]: `${JSON.stringify({ ...event, sessionId: event.id })}\n` });

    await app.send("POST", "/api/sync");

    await poll(() => stream.received).toContainEqual({ event: "events", data: { subjects: ["morse-code"] } });
  });

  it("announces the events of a first pull into a home with no commits yet", async () => {
    const remote = await mkdtemp(join(tmpdir(), "tomewise-remote-"));
    const agent = await mkdtemp(join(tmpdir(), "tomewise-agent-"));
    const event = { ...sessionStart(), id: "01KAJ0000000000000000PHONE", ts: "2026-11-22T08:00:00.000Z" };
    await git(remote, "init", "--bare", "--quiet", "--initial-branch=main");
    await git(agent, "init", "--quiet", "--initial-branch=main");
    await writeFiles(agent, { [`${EVENTS}/2026-11.phone.jsonl`]: `${JSON.stringify({ ...event, sessionId: event.id })}\n` });
    await git(agent, "add", "-A");
    await git(agent, "commit", "--quiet", "-m", "chore: phone");
    await git(agent, "push", "--quiet", remote, "main");
    const app = await startTestApp(async (root) => {
      await enableGit(root, { remote: "origin" });
      await git(root, "init", "--quiet", "--initial-branch=main");
      await git(root, "remote", "add", "origin", remote);
    });
    const stream = await app.changes();

    const response = await app.send("POST", "/api/sync");

    expect(response.body).toMatchObject({ stopped: false, lastError: null });
    await poll(() => stream.received).toContainEqual({ event: "events", data: { subjects: ["morse-code"] } });
  });

  it("announces no events when a pull brings only content", async () => {
    const { app, agentPushes } = await cloneSeam();
    const stream = await app.changes();
    await agentPushes({ [`${SUBJECT}/lessons/0005-e.html`]: "<!doctype html><title>E</title>" });

    await app.send("POST", "/api/sync");

    await poll(() => stream.received).toEqual([{ event: "content", data: {} }]);
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

    expect((await app.get("/api/sync")).body).toEqual({
      enabled: false,
      stopped: false,
      lastPull: null,
      lastCommit: null,
      lastPush: null,
      lastError: null,
    });
    expect((await app.send("POST", "/api/sync")).status).toBe(409);
    expect((await app.send("PUT", "/api/settings/theme", { value: "meadow" })).status).toBe(200);
    await advanceMinutes(60);
    expect(timers.size).toBe(0);
    expect(await appGitCalls(app.root)).toEqual([]);
  });
});

function practice(n: number, { minutes = 3, attempts = 2 } = {}) {
  const id = `01KAJ${String(n).padStart(21, "0")}`;
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 22, 8, 30 + minute, n)).toISOString();
  const ref = "lesson:0001-k-and-m";
  return [
    { id, ts: at(0), subject: "morse-code", kind: "session.start", ref, sessionId: id, schemaVersion: 2, data: {} },
    ...Array.from({ length: attempts }, () => ({
      ts: at(1),
      subject: "morse-code",
      kind: "attempt",
      ref: "item:letter-k",
      sessionId: id,
      duration: 600,
      outcome: "correct",
      grade: 3,
      schemaVersion: 2,
      data: { heard: "K", answer: "K", responseTime: 600, wpm: 18 },
    })),
    { ts: at(minutes), subject: "morse-code", kind: "session.end", ref, sessionId: id, duration: minutes * 60_000, schemaVersion: 2, data: {} },
  ];
}

async function subjects(root: string): Promise<string[]> {
  return (await git(root, "log", "--format=%s")).split("\n");
}

const ONE_SESSION = "chore(history): 2026-11-22 · morse-code 1 session, 3 min, 2 attempts";

describe("history commits", () => {
  it("commits the session's events after its session.end, on top of the agent's content", async () => {
    const { clock } = fakeClock();
    const { app, agentPushes, remote } = await cloneSeam({ remote: "origin" }, clock);
    await agentPushes({ [`${SUBJECT}/lessons/0005-e.html`]: "<!doctype html><title>E</title>" });
    const remoteHead = await git(remote, "rev-parse", "main");

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(() => subjects(app.root)).toEqual([ONE_SESSION, "feat: content", "chore: start"]);
    expect(await git(app.root, "log", "-1", "--format=%B")).toBe(ONE_SESSION);
    expect(await git(app.root, "show", "--name-only", "--format=", "HEAD")).toBe(`${EVENTS}/2026-11.jsonl`);
    expect(await git(app.root, "status", "--porcelain")).toBe("");
    expect((await app.get("/api/sync")).body).toMatchObject({ stopped: false, lastCommit: "2026-11-22T09:00:00.000Z", lastError: null });
    expect(await git(remote, "rev-parse", "main")).toBe(remoteHead);
  });

  it("waits for the session.end before committing", async () => {
    const { app } = await cloneSeam();
    const [start, ...rest] = practice(1);

    expect((await app.post(start)).status).toBe(201);
    await app.send("POST", "/api/sync");
    expect(await subjects(app.root)).toEqual(["chore: start"]);

    expect((await app.post(rest)).status).toBe(201);
    await poll(() => subjects(app.root)).toEqual([ONE_SESSION, "chore: start"]);
  });

  it("stages only event files and leaves other changes alone", async () => {
    const { app } = await cloneSeam({});
    await writeFiles(app.root, { "draft.md": "staged by hand\n", [`${SUBJECT}/scratch.md`]: "untracked\n" });
    await git(app.root, "add", "draft.md");

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(() => subjects(app.root)).toEqual([ONE_SESSION, "chore: start"]);
    expect(await git(app.root, "show", "--name-only", "--format=", "HEAD")).toBe(`${EVENTS}/2026-11.jsonl`);
    expect((await git(app.root, "status", "--porcelain")).split("\n").sort()).toEqual([`?? ${SUBJECT}/scratch.md`, "A  draft.md"]);
  });

  it("commits hourly on the clock, and not when nothing is new", async () => {
    const { clock, advanceMinutes } = fakeClock();
    const { app } = await cloneSeam({ cadence: "hourly" }, clock);
    expect((await app.post(practice(1))).status).toBe(201);

    await advanceMinutes(59);
    expect(await subjects(app.root)).toEqual(["chore: start"]);

    await advanceMinutes(1);
    expect(await subjects(app.root)).toEqual([ONE_SESSION, "chore: start"]);
    expect((await app.get("/api/sync")).body.lastCommit).toBe("2026-11-22T10:00:00.000Z");

    await advanceMinutes(60);
    expect(await subjects(app.root)).toEqual([ONE_SESSION, "chore: start"]);
    expect((await app.get("/api/sync")).body.lastCommit).toBe("2026-11-22T10:00:00.000Z");
  });

  it("commits nothing when the app stops, and commits at the next boundary after a restart", async () => {
    const { clock, advanceMinutes } = fakeClock();
    const { app } = await cloneSeam({ cadence: "daily" }, clock);
    expect((await app.post(practice(1))).status).toBe(201);
    await advanceMinutes(60);

    await app.restart(async () => {
      expect(await subjects(app.root)).toEqual(["chore: start"]);
    });
    expect(await subjects(app.root)).toEqual(["chore: start"]);

    await advanceMinutes(14 * 60);
    expect(await subjects(app.root)).toEqual([ONE_SESSION, "chore: start"]);
  });

  it("commits daily at midnight in the learning home's timezone, not a day after the app started", async () => {
    const { clock, advanceMinutes } = fakeClock();
    const { app } = await cloneSeam({ cadence: "daily" }, clock);
    expect((await app.post(practice(1))).status).toBe(201);
    expect((await app.post(practice(2, { minutes: 10, attempts: 5 }))).status).toBe(201);

    await advanceMinutes(15 * 60 - 1);
    expect(await subjects(app.root)).toEqual(["chore: start"]);

    await advanceMinutes(1);
    expect(await subjects(app.root)).toEqual(["chore(history): 2026-11-22 · morse-code 2 sessions, 13 min, 7 attempts", "chore: start"]);
    expect((await app.get("/api/sync")).body.lastCommit).toBe("2026-11-23T00:00:00.000Z");
  });

  it("commits hourly at the top of the hour, not an hour after the app started", async () => {
    const { clock, advanceMinutes } = fakeClock();
    await advanceMinutes(30);
    const { app } = await cloneSeam({ cadence: "hourly" }, clock);
    expect((await app.post(practice(1))).status).toBe(201);

    await advanceMinutes(29);
    expect(await subjects(app.root)).toEqual(["chore: start"]);

    await advanceMinutes(1);
    expect(await subjects(app.root)).toEqual([ONE_SESSION, "chore: start"]);
    expect((await app.get("/api/sync")).body.lastCommit).toBe("2026-11-22T10:00:00.000Z");
  });

  it("stops syncing and says why when git can't commit", async () => {
    const { clock } = fakeClock();
    const { app } = await cloneSeam({}, clock, { identity: false });

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(async () => (await app.get("/api/sync")).body).toMatchObject({
      stopped: true,
      lastCommit: null,
      lastError: { at: "2026-11-22T09:00:00.000Z", message: expect.stringContaining("git commit") },
    });
    expect(await subjects(app.root)).toEqual(["chore: start"]);
    expect(await git(app.root, "status", "--porcelain")).toMatch(/^[ M]{2} subjects\/morse-code\/events\/2026-11\.jsonl$/);
  });

  it("stops rather than commit event files that lost events", async () => {
    const { clock, advanceMinutes } = fakeClock();
    const { app } = await cloneSeam({ cadence: "hourly" }, clock);
    await rm(join(app.root, EVENTS, "2026-11.laptop.jsonl"));

    await advanceMinutes(60);

    expect((await app.get("/api/sync")).body).toMatchObject({
      stopped: true,
      lastCommit: null,
      lastError: { message: expect.stringContaining("without new events") },
    });
    expect(await subjects(app.root)).toEqual(["chore: start"]);
  });

  it("pulls before committing, and commits nothing when the pull fails", async () => {
    const { app, remote } = await cloneSeam();
    await rm(remote, { recursive: true });

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(async () => (await app.get("/api/sync")).body).toMatchObject({
      stopped: true,
      lastError: { message: expect.stringContaining("git pull") },
    });
    expect(await subjects(app.root)).toEqual(["chore: start"]);
    expect(await appGitCalls(app.root)).not.toContainEqual(expect.stringMatching(/^commit\b/));
  });
});

async function snapshotEvents(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(await snapshot(root))) if (path.startsWith(EVENTS)) files[path] = content;
  return files;
}

describe("pushing history", () => {
  it("pushes each history commit and reports the last push", async () => {
    const { clock } = fakeClock();
    const { app, remote } = await cloneSeam({ remote: "origin", push: true }, clock);

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(() => subjects(remote)).toEqual([ONE_SESSION, "chore: start"]);
    expect(await git(remote, "rev-parse", "main")).toBe(await git(app.root, "rev-parse", "HEAD"));
    expect((await app.get("/api/sync")).body).toMatchObject({
      stopped: false,
      lastCommit: "2026-11-22T09:00:00.000Z",
      lastPush: "2026-11-22T09:00:00.000Z",
      lastError: null,
    });
  });

  it("round-trips: the agent's lesson reaches the app and the learner's events reach the agent", async () => {
    const { app, agent, agentPushes } = await cloneSeam({ remote: "origin", push: true });
    await agentPushes({ [`${SUBJECT}/lessons/0005-e.html`]: "<!doctype html><title>E</title>" });

    await app.send("POST", "/api/sync");
    await poll(() => lessons(app)).toContain("0005-e");
    expect((await app.post(practice(1))).status).toBe(201);
    await poll(async () => (await app.get("/api/sync")).body.lastPush).not.toBeNull();

    await git(agent, "pull", "--quiet", "--ff-only");
    expect(await subjects(agent)).toEqual([ONE_SESSION, "feat: content", "chore: start"]);
    expect(await snapshotEvents(agent)).toEqual(await snapshotEvents(app.root));
    expect(await git(agent, "status", "--porcelain")).toBe("");
  });

  it("interleaves the agent's and the app's commits without conflicts on either side", async () => {
    const { app, agent, remote } = await cloneSeam({ remote: "origin", push: true });
    const agentCommits = async (name: string) => {
      await writeFiles(agent, { [`${SUBJECT}/lessons/${name}.html`]: `<!doctype html><title>${name}</title>` });
      await git(agent, "add", "-A");
      await git(agent, "commit", "--quiet", "-m", `feat: ${name}`);
    };
    const agentSyncs = async () => {
      await git(agent, "pull", "--quiet", "--rebase");
      await git(agent, "push", "--quiet", "origin", "main");
    };
    const appPractises = async (n: number) => {
      expect((await app.post(practice(n))).status).toBe(201);
      await poll(async () => (await subjects(remote))[0]).toBe(ONE_SESSION);
    };

    await agentCommits("0005-e");
    await appPractises(1);
    await agentSyncs();
    await appPractises(2);
    await agentCommits("0006-t");
    await agentSyncs();
    await app.send("POST", "/api/sync");

    expect((await app.get("/api/sync")).body).toMatchObject({ stopped: false, lastError: null });
    expect(await subjects(remote)).toEqual(["feat: 0006-t", ONE_SESSION, "feat: 0005-e", ONE_SESSION, "chore: start"]);
    const head = await git(remote, "rev-parse", "main");
    expect(await git(app.root, "rev-parse", "HEAD")).toBe(head);
    expect(await git(agent, "rev-parse", "HEAD")).toBe(head);
    expect(await git(app.root, "status", "--porcelain")).toBe("");
    expect(await git(agent, "status", "--porcelain")).toBe("");
    await poll(() => lessons(app)).toEqual(expect.arrayContaining(["0005-e", "0006-t"]));
  });

  it("pulls and pushes through a remote that keeps no tracking branch", async () => {
    const { app, remote, agentPushes } = await cloneSeam({ remote: "origin", push: true });
    await git(app.root, "config", "--unset-all", "remote.origin.fetch");
    await git(app.root, "update-ref", "-d", "refs/remotes/origin/main");
    await agentPushes({ [`${SUBJECT}/lessons/0005-e.html`]: "<!doctype html><title>E</title>" });

    expect((await app.send("POST", "/api/sync")).body).toMatchObject({ stopped: false, lastPush: null, lastError: null });
    expect((await app.post(practice(1))).status).toBe(201);

    await poll(() => subjects(remote)).toEqual([ONE_SESSION, "feat: content", "chore: start"]);
    await poll(async () => (await app.get("/api/sync")).body).toMatchObject({ stopped: false, lastPush: expect.any(String), lastError: null });
  });

  it("pushes nothing with push off", async () => {
    const { app, remote } = await cloneSeam({ remote: "origin", push: false });
    const remoteHead = await git(remote, "rev-parse", "main");

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(() => subjects(app.root)).toEqual([ONE_SESSION, "chore: start"]);
    expect(await git(remote, "rev-parse", "main")).toBe(remoteHead);
    expect((await app.get("/api/sync")).body).toMatchObject({ lastCommit: expect.any(String), lastPush: null });
    expect(await appGitCalls(app.root)).not.toContainEqual(expect.stringMatching(/^push\b/));
  });

  it("stops and says to check credentials when the remote refuses them", async () => {
    const { clock } = fakeClock();
    const { app, remote } = await cloneSeam({ remote: "origin", push: true }, clock);
    await refuseSshPush(app.root);

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(async () => (await app.get("/api/sync")).body).toMatchObject({
      stopped: true,
      lastPush: null,
      lastError: { at: "2026-11-22T09:00:00.000Z", message: expect.stringMatching(/credentials[\s\S]*Permission denied \(publickey\)/) },
    });
    expect(await subjects(app.root)).toEqual([ONE_SESSION, "chore: start"]);
    expect(await subjects(remote)).toEqual(["chore: start"]);
  });

  it("stops without forcing when the remote branch has diverged", async () => {
    const { app } = await cloneSeam({ remote: "origin", push: true });
    const diverged = await divergedPushTarget(app.root);
    const divergedHead = await git(diverged, "rev-parse", "main");

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(async () => (await app.get("/api/sync")).body).toMatchObject({
      stopped: true,
      lastPush: null,
      lastError: { message: expect.stringMatching(/diverged[\s\S]*never force-pushes[\s\S]*rejected/) },
    });
    expect(await git(diverged, "rev-parse", "main")).toBe(divergedHead);
    for (const call of await appGitCalls(app.root)) expect(call).not.toMatch(/--force|\s\+\S/);
  });

  it("pushes only the app's own history, and stops when the learner's commits are waiting", async () => {
    const { app, remote } = await cloneSeam({ remote: "origin", push: true });
    await writeFiles(app.root, { [`${SUBJECT}/notes.md`]: "server edit\n" });
    await git(app.root, "add", "-A");
    await git(app.root, "commit", "--quiet", "-m", "server edit");

    expect((await app.post(practice(1))).status).toBe(201);

    await poll(async () => (await app.get("/api/sync")).body).toMatchObject({
      stopped: true,
      lastPush: null,
      lastError: { message: expect.stringContaining("server edit") },
    });
    expect(await subjects(app.root)).toEqual([ONE_SESSION, "server edit", "chore: start"]);
    expect(await subjects(remote)).toEqual(["chore: start"]);
    expect(await appGitCalls(app.root)).not.toContainEqual(expect.stringMatching(/^push\b/));
  });

  it("pushes history left behind by a failed push on Sync now", async () => {
    const { app, remote } = await cloneSeam({ remote: "origin", push: true });
    await refuseSshPush(app.root);
    expect((await app.post(practice(1))).status).toBe(201);
    await poll(async () => (await app.get("/api/sync")).body.stopped).toBe(true);

    await git(app.root, "config", "--unset", "remote.origin.pushurl");
    const response = await app.send("POST", "/api/sync");

    expect(response.body).toMatchObject({ stopped: false, lastPush: expect.any(String), lastError: null });
    expect(await subjects(remote)).toEqual([ONE_SESSION, "chore: start"]);
  });
});

describe("settings commits", () => {
  it("commits a setting saved in the app on its own and pushes it", async () => {
    const { app, remote } = await cloneSeam({ remote: "origin", push: true });

    expect((await app.send("PUT", "/api/settings/theme", { value: "meadow" })).status).toBe(200);

    await poll(() => subjects(remote)).toEqual(["chore(home): set theme to meadow", "chore: start"]);
    expect(await git(app.root, "show", "--name-only", "--format=", "HEAD")).toBe("tomewise.json");
    expect(JSON.parse(await git(remote, "show", "main:tomewise.json")).theme).toBe("meadow");
    expect(await git(app.root, "status", "--porcelain")).toBe("");
  });

  it("commits only the key the learner saved, leaving the agent's uncommitted edits alone", async () => {
    const { app } = await cloneSeam({});
    const config = JSON.parse(await readFile(join(app.root, "tomewise.json"), "utf8"));
    await writeFile(join(app.root, "tomewise.json"), JSON.stringify({ ...config, weekStart: "sunday" }, null, 2));
    await writeFiles(app.root, { "draft.md": "staged by hand\n" });
    await git(app.root, "add", "draft.md");

    expect((await app.send("PUT", "/api/settings/start", { value: "ask" })).status).toBe(200);

    await poll(() => subjects(app.root)).toEqual(["chore(home): set start to ask", "chore: start"]);
    expect(await git(app.root, "show", "--name-only", "--format=", "HEAD")).toBe("tomewise.json");
    const committed = JSON.parse(await git(app.root, "show", "HEAD:tomewise.json"));
    expect(committed).toMatchObject({ start: "ask", weekStart: "monday" });
    expect(JSON.parse(await readFile(join(app.root, "tomewise.json"), "utf8"))).toMatchObject({ start: "ask", weekStart: "sunday" });
    expect((await git(app.root, "status", "--porcelain")).split("\n").sort()).toEqual([" M tomewise.json", "A  draft.md"]);
  });

  it("commits a subject's assessment settings under the subject's scope", async () => {
    const { app, remote } = await cloneSeam({ remote: "origin", push: true });
    const value = { passMark: 90, scoreDisplay: "pass-fail" };

    expect((await app.send("PUT", "/api/settings/subjects/morse-code/assessments", { value })).status).toBe(200);

    await poll(() => subjects(remote)).toEqual(["chore(morse-code): set assessments", "chore: start"]);
    expect(await git(app.root, "show", "--name-only", "--format=", "HEAD")).toBe(`${SUBJECT}/subject.json`);
    expect(JSON.parse(await git(remote, "show", `main:${SUBJECT}/subject.json`)).settings.assessments).toEqual(value);
    expect(await git(app.root, "status", "--porcelain")).toBe("");
  });

  it("commits a setting saved while sync was stopped on Sync now", async () => {
    const { app, remote } = await cloneSeam({ remote: "origin", push: true });
    await refuseSshPush(app.root);
    expect((await app.send("PUT", "/api/settings/theme", { value: "meadow" })).status).toBe(200);
    await poll(async () => (await app.get("/api/sync")).body.stopped).toBe(true);
    expect((await app.send("PUT", "/api/settings/start", { value: "ask" })).status).toBe(200);

    await git(app.root, "config", "--unset", "remote.origin.pushurl");
    const response = await app.send("POST", "/api/sync");

    expect(response.body).toMatchObject({ stopped: false, lastError: null });
    expect(await subjects(remote)).toEqual(["chore(home): set start to ask", "chore(home): set theme to meadow", "chore: start"]);
  });

  it("commits a setting with no remote, and pushes nothing with push off", async () => {
    const { app, remote } = await cloneSeam({ remote: "origin" });

    expect((await app.send("PUT", "/api/settings/subjects", { value: ["morse-code"] })).status).toBe(200);

    await poll(() => subjects(app.root)).toEqual(["chore(home): set subject order", "chore: start"]);
    expect(await subjects(remote)).toEqual(["chore: start"]);
    expect(await appGitCalls(app.root)).not.toContainEqual(expect.stringMatching(/^push\b/));
  });
});

async function refuseSshPush(root: string) {
  const ssh = join(await tempDir(), "ssh");
  await writeFile(ssh, "#!/bin/sh\necho 'git@example.invalid: Permission denied (publickey).' >&2\nexit 255\n");
  await chmod(ssh, 0o755);
  await git(root, "config", "remote.origin.pushurl", "git@example.invalid:learner/learning.git");
  await git(root, "config", "core.sshCommand", ssh);
}

async function divergedPushTarget(root: string): Promise<string> {
  const diverged = await mkdtemp(join(tmpdir(), "tomewise-diverged-"));
  await git(diverged, "clone", "--quiet", "--bare", await git(root, "remote", "get-url", "origin"), ".");
  const other = await mkdtemp(join(tmpdir(), "tomewise-other-"));
  await git(other, "clone", "--quiet", diverged, ".");
  await git(other, "commit", "--quiet", "--allow-empty", "-m", "elsewhere");
  await git(other, "push", "--quiet", "origin", "main");
  await git(root, "config", "remote.origin.pushurl", diverged);
  return diverged;
}
