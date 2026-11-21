import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { snapshot } from "../../core/test/helpers.ts";
import { EVENTS, startTestApp } from "../../app/test/harness.ts";
import { run } from "../src/main.ts";

const SESSION = "01KAJ0000000000000000000S1";

const start = {
  id: SESSION,
  ts: "2026-11-21T18:00:00.000Z",
  subject: "morse-code",
  kind: "session.start",
  ref: "lesson:0001-k-and-m",
  sessionId: SESSION,
  schemaVersion: 2,
  data: {},
};

async function homeWithConfig(config: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "tomewise-cli-home-"));
  await mkdir(join(home, ".config", "tomewise"), { recursive: true });
  await writeFile(join(home, ".config", "tomewise", "config.json"), JSON.stringify(config));
  return home;
}

async function tome(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, {
    cwd,
    env,
    machine: "agent-box",
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("tome log with the app running", () => {
  it("sends the event to the app's URL from the global config, so it lands in the main monthly file", async () => {
    const app = await startTestApp();
    const before = await app.lines("2026-11.jsonl");
    const files = await app.eventFiles();

    const result = await tome(["log", JSON.stringify(start)], app.root, { HOME: await homeWithConfig({ appUrl: app.url }) });

    expect(result).toEqual({ code: 0, stdout: JSON.stringify(start), stderr: "" });
    expect(await app.lines("2026-11.jsonl")).toEqual([...before, start]);
    expect(await app.eventFiles()).toEqual(files);
  });
});

describe("tome log with the app stopped", () => {
  it("writes the event to this machine's file and says where", async () => {
    const app = await startTestApp();
    const before = await app.lines("2026-11.jsonl");
    await app.stop();

    const result = await tome(["log", JSON.stringify(start)], app.root, { HOME: await homeWithConfig({ appUrl: app.url }) });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(JSON.stringify(start));
    const file = join(app.root, EVENTS, "2026-11.agent-box.jsonl");
    expect(result.stderr).toBe(`Could not reach the app at ${app.url} (ECONNREFUSED); wrote the event to ${file} instead.`);
    expect(await app.lines("2026-11.agent-box.jsonl")).toEqual([start]);
    expect(await app.lines("2026-11.jsonl")).toEqual(before);
  });
});

describe("tome log with an invalid event", () => {
  it("prints the issues the app found, exits non-zero and writes nothing", async () => {
    const app = await startTestApp();
    const before = await snapshot(app.root);

    const result = await tome(["log", JSON.stringify({ ...start, kind: "session.begin" })], app.root, {
      HOME: await homeWithConfig({ appUrl: app.url }),
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^events\[0\]: kind: Unknown kind/m);
    expect(await snapshot(app.root)).toEqual(before);
  });
});

describe("finding the app", () => {
  it("prefers TOMEWISE_URL over the global config", async () => {
    const stopped = await startTestApp();
    await stopped.stop();
    const app = await startTestApp();
    const before = await app.lines("2026-11.jsonl");

    const result = await tome(["log", JSON.stringify(start)], app.root, {
      HOME: await homeWithConfig({ appUrl: stopped.url }),
      TOMEWISE_URL: app.url,
    });

    expect(result.code).toBe(0);
    expect(await app.lines("2026-11.jsonl")).toEqual([...before, start]);
  });

  it("rejects a TOMEWISE_URL that isn't an http URL", async () => {
    const app = await startTestApp();

    const result = await tome(["log", JSON.stringify(start)], app.root, { HOME: await homeWithConfig({}), TOMEWISE_URL: "localhost:4777" });

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/TOMEWISE_URL/);
  });

  it("rejects an appUrl in the global config that isn't an http URL", async () => {
    const app = await startTestApp();

    const result = await tome(["log", JSON.stringify(start)], app.root, { HOME: await homeWithConfig({ appUrl: "nope" }) });

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/config\.json.*\n.*appUrl/);
  });

  it("writes this machine's file with a notice when no app URL is set", async () => {
    const app = await startTestApp();

    const result = await tome(["log", JSON.stringify(start)], app.root, { HOME: await homeWithConfig({}) });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe(
      `No app URL set (appUrl in ~/.config/tomewise/config.json or TOMEWISE_URL); wrote the event to ${join(app.root, EVENTS, "2026-11.agent-box.jsonl")} instead.`,
    );
    expect(await app.lines("2026-11.agent-box.jsonl")).toEqual([start]);
  });

  it("gives up on a host that never answers within a few seconds and writes this machine's file", async () => {
    const app = await startTestApp();
    const silent = createServer(() => {});
    const sockets = new Set<Socket>();
    silent.on("connection", (socket) => sockets.add(socket));
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    onTestFinished(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => silent.close(resolve));
    });
    const url = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
    const began = Date.now();

    const result = await tome(["log", JSON.stringify(start)], app.root, { HOME: await homeWithConfig({ appUrl: url }) });

    expect(Date.now() - began).toBeLessThan(4000);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/^Could not reach the app at http:\/\/127\.0\.0\.1:\d+ \(no answer within 2s\)/);
    expect(await app.lines("2026-11.agent-box.jsonl")).toEqual([start]);
  });
});
