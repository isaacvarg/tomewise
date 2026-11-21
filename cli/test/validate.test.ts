import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { run } from "../src/main.ts";

async function home(config: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tomewise-cli-"));
  await writeFile(join(root, "tomewise.json"), JSON.stringify(config));
  return root;
}

async function tome(args: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const env = { HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")) };
  const code = await run(args, {
    cwd,
    env,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("tome validate", () => {
  it("exits zero on a valid learning home", async () => {
    const root = await home({ formatVersion: 1 });

    const result = await tome(["validate"], root);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(root);
  });

  it("prints file, field path and problem for each error, and exits non-zero", async () => {
    const root = await home({ formatVersion: 1, weekStart: "funday", timezone: "Mars/Olympus_Mons" });

    const result = await tome(["validate"], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^tomewise\.json: timezone: Unknown timezone "Mars\/Olympus_Mons"/m);
    expect(result.stderr).toMatch(/^tomewise\.json: weekStart: .*monday/m);
  });

  it("works from a folder nested inside the learning home", async () => {
    const root = await home({ formatVersion: 1 });
    const nested = join(root, "subjects", "morse-code");
    await mkdir(nested, { recursive: true });

    expect((await tome(["validate"], nested)).code).toBe(0);
  });

  it("explains how to create a learning home when there is none", async () => {
    const result = await tome(["validate"], await mkdtemp(join(tmpdir(), "tomewise-cli-")));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("tome init");
  });

  it("reports an unreadable global config without crashing", async () => {
    const env = { HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")) };
    await mkdir(join(env.HOME, ".config", "tomewise"), { recursive: true });
    await writeFile(join(env.HOME, ".config", "tomewise", "config.json"), "{ not json");
    const err: string[] = [];

    const code = await run(["validate"], {
      cwd: await mkdtemp(join(tmpdir(), "tomewise-cli-")),
      env,
      stdout: () => {},
      stderr: (line) => err.push(line),
    });

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/config\.json: Invalid JSON/);
  });

  it("runs as a real process", async () => {
    const root = await home({ formatVersion: 1, weekStart: "funday" });
    const main = new URL("../src/main.ts", import.meta.url).pathname;

    const failure = await promisify(execFile)(process.execPath, [main, "validate"], { cwd: root }).catch(
      (e: { code: number; stderr: string }) => e,
    );

    expect(failure).toMatchObject({ code: 1, stderr: expect.stringContaining("tomewise.json: weekStart:") });
  });
});
