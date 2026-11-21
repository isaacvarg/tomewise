import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { machineName } from "@tomewise/core";
import { buildHome, snapshot } from "../../core/test/helpers.ts";
import { run } from "../src/main.ts";

const SESSION = "01KAJ0000000000000000000S1";

const start = {
  id: SESSION,
  ts: "2026-11-03T18:00:00.000Z",
  subject: "morse-code",
  kind: "session.start",
  ref: "lesson:0001-k-and-m",
  sessionId: SESSION,
  schemaVersion: 1,
};

function homeFiles() {
  return {
    "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
    "subjects/morse-code/subject.json": { name: "Morse code" },
    "subjects/morse-code/lessons/0001-k-and-m.html": "<h1>K and M</h1>",
  };
}

async function tome(args: string[], cwd: string, stdin = "") {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, {
    cwd,
    env: { HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")) },
    machine: "Isaacs-Laptop.local",
    readStdin: async () => stdin,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("tome log", () => {
  it("appends the event to this machine's file for its month and prints it", async () => {
    const root = await buildHome(homeFiles());

    const result = await tome(["log", JSON.stringify(start)], root);

    expect(result.code).toBe(0);
    const text = await readFile(join(root, "subjects/morse-code/events/2026-11.isaacs-laptop-local.jsonl"), "utf8");
    expect(text).toBe(`${JSON.stringify({ ...start, data: {} })}\n`);
    expect(result.stdout).toBe(text.trimEnd());
  });

  it("reads the event from stdin when given -", async () => {
    const root = await buildHome(homeFiles());

    expect((await tome(["log", "-"], root, JSON.stringify(start))).code).toBe(0);
    expect(await readdir(join(root, "subjects/morse-code/events"))).toEqual(["2026-11.isaacs-laptop-local.jsonl"]);
  });

  it("rejects a bad event, prints why, and writes nothing", async () => {
    const root = await buildHome(homeFiles());
    const before = await snapshot(root);

    const result = await tome(["log", JSON.stringify({ ...start, ref: "lesson:0009-nope", kind: "session.begin" })], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^event: kind: Unknown kind/m);
    expect(await snapshot(root)).toEqual(before);
  });

  it("rejects text that isn't JSON", async () => {
    const result = await tome(["log", "{ nope"], await buildHome(homeFiles()));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^event: Invalid JSON/);
  });

  it("prints usage without an event", async () => {
    expect((await tome(["log"], await buildHome(homeFiles()))).code).toBe(2);
  });

  it("is reported by tome validate with file and line when a line goes bad", async () => {
    const root = await buildHome({
      ...homeFiles(),
      "subjects/morse-code/events/2026-11.jsonl": `${JSON.stringify(start)}\n${JSON.stringify({ ...start, id: "bad" })}\n`,
    });

    const result = await tome(["validate"], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^subjects\/morse-code\/events\/2026-11\.jsonl:2: id: Use a ULID/m);
  });

  it("runs as a real process, naming the file after this machine", async () => {
    const root = await buildHome(homeFiles());
    const main = new URL("../src/main.ts", import.meta.url).pathname;

    await promisify(execFile)(process.execPath, [main, "log", JSON.stringify(start)], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")) },
    });

    expect(await readdir(join(root, "subjects/morse-code/events"))).toEqual([`2026-11.${machineName(hostname())}.jsonl`]);
  });
});
