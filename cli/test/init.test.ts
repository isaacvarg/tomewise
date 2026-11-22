import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { run } from "../src/main.ts";
import type { PromptStreams } from "../src/prompt.ts";

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function tome(args: string[], cwd: string, HOME: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, {
    cwd,
    env: { HOME },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

async function readJsonFile(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

const globalConfig = (HOME: string) => join(HOME, ".config", "tomewise", "config.json");

describe("tome init", () => {
  it("creates a learning home from flags that tome validate accepts, from anywhere", async () => {
    const parent = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const root = join(parent, "learning");

    const result = await tome(
      [
        "init",
        "learning",
        "--timezone",
        "Europe/London",
        "--week-start",
        "sunday",
        "--rest-days",
        "1",
        "--app-url",
        "http://localhost:4800",
      ],
      parent,
      HOME,
    );

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(root);
    expect(await readJsonFile(join(root, "tomewise.json"))).toEqual({
      formatVersion: 1,
      timezone: "Europe/London",
      weekStart: "sunday",
      streak: { restDaysPerWeek: 1 },
    });
    expect(await readdir(join(root, "subjects"))).toEqual([]);
    expect(await readJsonFile(globalConfig(HOME))).toEqual({ learningHome: root, appUrl: "http://localhost:4800" });

    const elsewhere = await temp("tomewise-init-elsewhere-");
    const validated = await tome(["validate"], elsewhere, HOME);
    expect(validated.code).toBe(0);
    expect(validated.stdout).toContain(root);
  });

  it("always writes timezone, defaulting to the system zone", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tome(["init"], root, HOME);

    expect(result.code).toBe(0);
    expect(await readJsonFile(join(root, "tomewise.json"))).toEqual({
      formatVersion: 1,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      weekStart: "monday",
      streak: { restDaysPerWeek: 0 },
    });
    expect(await readJsonFile(globalConfig(HOME))).toEqual({ learningHome: root, appUrl: "http://127.0.0.1:4777" });
  });

  it("updates the global config, keeping other keys", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    await mkdir(join(HOME, ".config", "tomewise"), { recursive: true });
    await writeFile(
      globalConfig(HOME),
      JSON.stringify({ learningHome: "/old/home", appUrl: "http://old:1", editor: "vim" }),
    );

    const result = await tome(["init", root, "--app-url", "https://tome.example.com"], root, HOME);

    expect(result.code).toBe(0);
    expect(await readJsonFile(globalConfig(HOME))).toEqual({
      learningHome: root,
      appUrl: "https://tome.example.com",
      editor: "vim",
    });
  });

  it("refuses where a learning home already exists, changing nothing", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const existing = JSON.stringify({ formatVersion: 1, weekStart: "friday" });
    await writeFile(join(root, "tomewise.json"), existing);

    const result = await tome(["init", root, "--timezone", "Asia/Tokyo"], root, HOME);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`${root} is already a learning home`);
    expect(await readFile(join(root, "tomewise.json"), "utf8")).toBe(existing);
    expect(await readdir(root)).toEqual(["tomewise.json"]);
    expect(await readdir(HOME)).toEqual([]);
  });

  it("reports invalid values and writes nothing", async () => {
    const parent = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tome(
      [
        "init",
        "learning",
        "--timezone",
        "Mars/Olympus_Mons",
        "--app-url",
        "not a url",
        "--week-start",
        "funday",
        "--rest-days",
        "7",
      ],
      parent,
      HOME,
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^--timezone: Unknown timezone "Mars\/Olympus_Mons"/m);
    expect(result.stderr).toMatch(/^--app-url: .*http/m);
    expect(result.stderr).toMatch(/^--week-start: .*monday/m);
    expect(result.stderr).toMatch(/^--rest-days: /m);
    expect(await readdir(parent)).toEqual([]);
    expect(await readdir(HOME)).toEqual([]);
  });

  it("rejects a rest-days value that isn't a whole number", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tome(["init", root, "--rest-days", "two"], root, HOME);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^--rest-days: /m);
    expect(await readdir(root)).toEqual([]);
  });

  it("writes nothing when the existing global config is unreadable", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    await mkdir(join(HOME, ".config", "tomewise"), { recursive: true });
    await writeFile(globalConfig(HOME), "{ not json");

    const result = await tome(["init", root], root, HOME);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("config.json");
    expect(await readdir(root)).toEqual([]);
    expect(await readFile(globalConfig(HOME), "utf8")).toBe("{ not json");
  });

  it("rejects unknown flags with usage", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tome(["init", root, "--colour", "red"], root, HOME);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("tome init");
    expect(await readdir(root)).toEqual([]);
  });
});

function scripted(lines: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = "";
  output.on("data", (chunk) => (shown += chunk));
  input.end(lines.map((line) => `${line}\n`).join(""));
  return { streams: { input, output, terminal: false }, shown: () => shown };
}

async function tomeAsked(args: string[], cwd: string, HOME: string, prompt: PromptStreams) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, {
    cwd,
    env: { HOME },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    prompt,
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("tome init prompts", () => {
  it("asks every answer with no flags and writes what the flag path writes", async () => {
    const parent = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const flagsParent = await temp("tomewise-init-flags-");
    const flagsHOME = await temp("tomewise-init-flags-home-");
    const root = join(parent, "learning");
    const script = scripted(["learning", "Europe/London", "Sunday", "1", "http://localhost:4800", "n"]);

    const asked = await tomeAsked(["init"], parent, HOME, script.streams);
    const flagged = await tome(
      ["init", "learning", "--timezone", "Europe/London", "--week-start", "sunday", "--rest-days", "1", "--app-url", "http://localhost:4800"],
      flagsParent,
      flagsHOME,
    );

    expect(asked.stderr).toBe("");
    expect(asked.code).toBe(0);
    expect(flagged.code).toBe(0);
    for (const question of ["learning home go", "Timezone", "Week starts on", "Rest days per week", "App URL", "Set up git?"]) {
      expect(script.shown()).toContain(question);
    }
    expect(await readFile(join(root, "tomewise.json"), "utf8")).toBe(
      await readFile(join(flagsParent, "learning", "tomewise.json"), "utf8"),
    );
    expect(await readJsonFile(globalConfig(HOME))).toEqual({ learningHome: root, appUrl: "http://localhost:4800" });
    expect((await readdir(root)).sort()).toEqual(["subjects", "tomewise.json"]);
  });

  it("offers the system timezone and the defaults, taking each on Enter", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const script = scripted(["", "", "", "", "", "n"]);

    const result = await tomeAsked(["init"], root, HOME, script.streams);

    expect(result.code).toBe(0);
    expect(script.shown()).toContain(`Timezone [${zone}]: `);
    expect(script.shown()).toContain(`learning home go? [${root}]: `);
    expect(await readJsonFile(join(root, "tomewise.json"))).toEqual({
      formatVersion: 1,
      timezone: zone,
      weekStart: "monday",
      streak: { restDaysPerWeek: 0 },
    });
    expect(await readJsonFile(globalConfig(HOME))).toEqual({ learningHome: root, appUrl: "http://127.0.0.1:4777" });
  });

  it("skips questions answered by flags", async () => {
    const parent = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const script = scripted(["friday", "2"]);

    const result = await tomeAsked(
      ["init", "learning", "--timezone", "Asia/Tokyo", "--app-url", "http://localhost:1", "--no-git"],
      parent,
      HOME,
      script.streams,
    );

    expect(result.code).toBe(0);
    for (const question of ["learning home go", "Timezone", "App URL", "git"]) {
      expect(script.shown()).not.toContain(question);
    }
    expect(await readJsonFile(join(parent, "learning", "tomewise.json"))).toEqual({
      formatVersion: 1,
      timezone: "Asia/Tokyo",
      weekStart: "friday",
      streak: { restDaysPerWeek: 2 },
    });
  });

  it("asks again after an invalid answer", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const script = scripted([".", "Mars/Olympus_Mons", "UTC", "funday", "tuesday", "seven", "9", "3", "not a url", "", "maybe", "n"]);

    const result = await tomeAsked(["init"], root, HOME, script.streams);

    expect(result.code).toBe(0);
    expect(script.shown()).toContain('Unknown timezone "Mars/Olympus_Mons"');
    expect(script.shown()).toContain('Answer "y" or "n".');
    expect(await readJsonFile(join(root, "tomewise.json"))).toEqual({
      formatVersion: 1,
      timezone: "UTC",
      weekStart: "tuesday",
      streak: { restDaysPerWeek: 3 },
    });
  });

  it("runs git init and adds the remote when git is chosen", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const script = scripted(["", "", "", "", "", "y", "git@example.com:me/learning.git"]);

    const result = await tomeAsked(["init"], root, HOME, script.streams);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(git(root, ["rev-parse", "--show-toplevel"])).toBe(await realpath(root));
    expect(git(root, ["remote", "get-url", "origin"])).toBe("git@example.com:me/learning.git");
  });

  it("runs git init without a remote when the remote is left blank", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tomeAsked(["init"], root, HOME, scripted(["", "", "", "", "", "", ""]).streams);

    expect(result.code).toBe(0);
    expect(await readdir(join(root, ".git"))).toContain("HEAD");
    expect(git(root, ["remote"])).toBe("");
  });

  it("leaves git alone when git is declined", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tomeAsked(["init"], root, HOME, scripted(["", "", "", "", "", "no"]).streams);

    expect(result.code).toBe(0);
    expect(await readdir(root)).not.toContain(".git");
  });

  it("sets up git from flags without prompts", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tome(["init", root, "--remote", "https://example.com/learning.git"], root, HOME);

    expect(result.code).toBe(0);
    expect(git(root, ["remote", "get-url", "origin"])).toBe("https://example.com/learning.git");
  });

  it("rejects --remote with --no-git", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tome(["init", root, "--no-git", "--remote", "https://example.com/x.git"], root, HOME);

    expect(result.code).toBe(2);
    expect(await readdir(root)).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])("writes nothing when the input ends after %i answers", async (answered) => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const answers = ["", "", "", "", "", "y", ""].slice(0, answered - 1);

    const result = await tomeAsked(["init"], root, HOME, scripted(answers).streams);

    expect(result.code).toBe(130);
    expect(result.stderr).toContain("Nothing was written");
    expect(await readdir(root)).toEqual([]);
    expect(await readdir(HOME)).toEqual([]);
  });

  it("writes nothing on Ctrl-C at a prompt", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();

    const pending = tomeAsked(["init"], root, HOME, { input, output, terminal: true });
    input.write("\r");
    input.write("Europe/London\r");
    input.write("\x03");
    const result = await pending;

    expect(result.code).toBe(130);
    expect(await readdir(root)).toEqual([]);
    expect(await readdir(HOME)).toEqual([]);
  });

  it("stops before asking more when the chosen folder is already a learning home", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    await writeFile(join(root, "tomewise.json"), "{}");
    const script = scripted([""]);

    const result = await tomeAsked(["init"], root, HOME, script.streams);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("already a learning home");
    expect(script.shown()).not.toContain("Timezone");
  });
});
