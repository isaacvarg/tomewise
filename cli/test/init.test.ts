import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
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
    const script = scripted(["learning", "Europe/London", "Sunday", "1", "http://localhost:4800", "n", "none", ""]);

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
    const script = scripted(["", "", "", "", "", "n", "none", ""]);

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
    const script = scripted(["friday", "2", "none", ""]);

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
    const script = scripted([".", "Mars/Olympus_Mons", "UTC", "funday", "tuesday", "seven", "9", "3", "not a url", "", "maybe", "n", "none", ""]);

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
    const script = scripted(["", "", "", "", "", "y", "git@example.com:me/learning.git", "none", ""]);

    const result = await tomeAsked(["init"], root, HOME, script.streams);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(git(root, ["rev-parse", "--show-toplevel"])).toBe(await realpath(root));
    expect(git(root, ["remote", "get-url", "origin"])).toBe("git@example.com:me/learning.git");
  });

  it("runs git init without a remote when the remote is left blank", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tomeAsked(["init"], root, HOME, scripted(["", "", "", "", "", "", "", "none", ""]).streams);

    expect(result.code).toBe(0);
    expect(await readdir(join(root, ".git"))).toContain("HEAD");
    expect(git(root, ["remote"])).toBe("");
  });

  it("leaves git alone when git is declined", async () => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");

    const result = await tomeAsked(["init"], root, HOME, scripted(["", "", "", "", "", "no", "none", ""]).streams);

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

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("writes nothing when the input ends after %i answers", async (answered) => {
    const root = await temp("tomewise-init-");
    const HOME = await temp("tomewise-init-home-");
    const answers = ["", "", "", "", "", "y", "", "none", ""].slice(0, answered - 1);

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

interface Handoff {
  args: string[];
  lines?: string[];
  signal?: AbortSignal;
}

async function handoff({ args, lines, signal }: Handoff) {
  const root = await temp("tomewise-init-");
  const HOME = await temp("tomewise-init-home-");
  const out: string[] = [];
  const err: string[] = [];
  const commands: string[][] = [];
  const script = lines ? scripted(lines) : undefined;
  const code = await run(["init", root, "--timezone", "UTC", "--no-git", ...args], {
    cwd: root,
    env: { HOME },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    prompt: script?.streams,
    signal,
    service: {
      platform: "linux",
      program: ["/usr/bin/node", "/opt/tomewise/lib/tome.js"],
      uid: 1000,
      exec: async (command, rest) => {
        commands.push([command, ...rest]);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  });
  return { code, root, HOME, commands, stdout: out.join("\n"), stderr: err.join("\n"), shown: () => script?.shown() ?? "" };
}

const unitFile = (HOME: string) => join(HOME, ".config", "systemd", "user", "tomewise.service");

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("tome init handoffs", () => {
  it("installs the service for the new learning home with --app service", async () => {
    const result = await handoff({ args: ["--app", "service", "--app-url", "http://127.0.0.1:4800"] });

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const unit = await readFile(unitFile(result.HOME), "utf8");
    expect(unit).toContain(`WorkingDirectory=${result.root}`);
    expect(unit).toContain(`"serve" "--host" "127.0.0.1" "--port" "4800"`);
    expect(result.commands).toContainEqual(["systemctl", "--user", "enable", "tomewise.service"]);
  });

  it("installs the service when asked", async () => {
    const result = await handoff({ args: [], lines: ["", "", "", "service", ""] });

    expect(result.code).toBe(0);
    expect(result.shown()).toContain("Run the app now, install it as a service, or print the Docker command?");
    expect(await readFile(unitFile(result.HOME), "utf8")).toContain(`WorkingDirectory=${result.root}`);
  });

  it("prints a Docker command with the learning home mounted and the app URL's port published", async () => {
    const result = await handoff({ args: ["--app", "docker", "--app-url", "http://127.0.0.1:4800"] });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`-v '${result.root}':/learning-home`);
    expect(result.stdout).toContain("-p 127.0.0.1:4800:4777");
    expect(result.stdout).toContain("docker build -t tomewise .");
    expect(await exists(unitFile(result.HOME))).toBe(false);
  });

  it("serves the new learning home with --app now", async () => {
    const stop = new AbortController();
    stop.abort();
    const result = await handoff({ args: ["--app", "now", "--app-url", "http://127.0.0.1:0"], signal: stop.signal });

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Listening on http:\/\/127\.0\.0\.1:\d+$/m);
  });

  it("runs nothing by default without prompts, and nothing when none is chosen", async () => {
    const flagged = await handoff({ args: [] });
    const asked = await handoff({ args: [], lines: ["", "", "", "none", ""] });

    for (const result of [flagged, asked]) {
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("Listening on");
      expect(result.stdout).not.toContain("docker run");
      expect(result.commands).toEqual([]);
    }
  });

  it("asks again after an unknown app choice and rejects an unknown --app", async () => {
    const asked = await handoff({ args: [], lines: ["", "", "", "later", "none", ""] });
    const flagged = await handoff({ args: ["--app", "later"] });

    expect(asked.code).toBe(0);
    expect(asked.shown()).toContain('Answer "now", "service", "docker" or "none".');
    expect(flagged.code).toBe(2);
    expect(flagged.stderr).toContain("--app");
    expect(await readdir(flagged.root)).toEqual([]);
  });

  it("prints how to install the skill", async () => {
    const result = await handoff({ args: [] });

    expect(result.stdout).toContain("skill");
    expect(result.stdout).toContain("~/.claude/skills/teach");
  });

  it("prints the agent prompt for the first subject, naming what to learn", async () => {
    const asked = await handoff({ args: [], lines: ["", "", "", "none", "Morse code"] });
    const flagged = await handoff({ args: ["--subject", "Morse code"] });

    for (const result of [asked, flagged]) {
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Give your agent this message to create your first subject:");
      expect(result.stdout).toContain(`/teach Set up a new subject in ${result.root}: Morse code`);
    }
  });

  it("prints a generic first-subject prompt without prompts, and none when skipped", async () => {
    const generic = await handoff({ args: [] });
    const skippedByFlag = await handoff({ args: ["--no-subject"] });
    const skippedByAnswer = await handoff({ args: [], lines: ["", "", "", "none", ""] });

    expect(generic.stdout).toContain(`/teach Set up a new subject in ${generic.root}.`);
    expect(skippedByFlag.stdout).not.toContain("first subject");
    expect(skippedByAnswer.shown()).toContain("What do you want to learn first? (blank to skip)");
    expect(skippedByAnswer.stdout).not.toContain("first subject");
  });

  it("asks the handoff questions before writing anything", async () => {
    const result = await handoff({ args: [], lines: ["", "", "", "service"] });

    expect(result.code).toBe(130);
    expect(await readdir(result.root)).toEqual([]);
    expect(result.commands).toEqual([]);
  });
});
