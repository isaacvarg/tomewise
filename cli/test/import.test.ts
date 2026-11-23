import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshot } from "../../core/test/helpers.ts";
import { startTestApp } from "../../app/test/harness.ts";
import { run } from "../src/main.ts";

const LESSONS = ["0001-first-two-sounds", "0002-the-mirror", "0003-all-light", "0004-the-late-bump"];
const SUBJECT = "subjects/morse";

async function workspace(): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), "tomewise-teach-")), "morse");
  await cp(new URL("fixtures/teach-morse/", import.meta.url), dir, { recursive: true });
  return dir;
}

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

async function eventsIn(root: string, subject = SUBJECT): Promise<Record<string, any[]>> {
  const dir = join(root, subject, "events");
  const files: Record<string, any[]> = {};
  for (const name of await readdir(dir)) {
    const text = await readFile(join(dir, name), "utf8");
    files[name] = text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));
  }
  return files;
}

function month(): string {
  return new Date().toISOString().slice(0, 7);
}

function completed(subject = "morse") {
  return LESSONS.map((lesson) =>
    expect.objectContaining({ subject, kind: "lesson.completed", ref: `lesson:${lesson}`, schemaVersion: 1, data: {} }),
  );
}

describe("tome import with the app running", () => {
  it("copies the workspace into a new subject and sends one lesson.completed per lesson to the app", async () => {
    const app = await startTestApp();
    const dir = await workspace();
    const began = Date.now();

    const result = await tome(["import", dir], app.root, { HOME: await homeWithConfig({ appUrl: app.url }) });

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const files = await snapshot(join(app.root, SUBJECT));
    const { "subject.json": subjectJson, ...copied } = files;
    expect(Object.keys(copied).filter((file) => !file.startsWith("events/")).sort()).toEqual(Object.keys(await snapshot(dir)).sort());
    for (const [file, text] of Object.entries(await snapshot(dir))) expect(copied[file]).toBe(text);
    expect(JSON.parse(subjectJson!)).toEqual({ name: "Morse Code" });

    const events = await eventsIn(app.root);
    expect(Object.keys(events)).toEqual([`${month()}.jsonl`]);
    expect(events[`${month()}.jsonl`]).toEqual(completed());
    for (const event of events[`${month()}.jsonl`]!) expect(Date.parse(event.ts)).toBeGreaterThanOrEqual(began - 1000);

    expect((await tome(["validate"], app.root, { HOME: await homeWithConfig({}) })).code).toBe(0);
  });

  it("lets the app list the new subject's lessons as complete", async () => {
    const app = await startTestApp();

    await tome(["import", await workspace()], app.root, { HOME: await homeWithConfig({ appUrl: app.url }) });

    const { status, body } = await app.get("/api/subjects/morse/events");
    expect(status).toBe(200);
    expect(JSON.stringify(body)).toContain("lesson:0004-the-late-bump");
  });
});

describe("tome import with the app stopped", () => {
  it("writes the lesson.completed events to this machine's file and says where", async () => {
    const app = await startTestApp();
    await app.stop();

    const result = await tome(["import", await workspace()], app.root, { HOME: await homeWithConfig({ appUrl: app.url }) });

    expect(result.code).toBe(0);
    const file = join(app.root, SUBJECT, "events", `${month()}.agent-box.jsonl`);
    expect(result.stderr).toBe(`Could not reach the app at ${app.url} (ECONNREFUSED); wrote the events to ${file} instead.`);
    expect(await eventsIn(app.root)).toEqual({ [`${month()}.agent-box.jsonl`]: completed() });
    expect((await tome(["validate"], app.root, { HOME: await homeWithConfig({}) })).code).toBe(0);
  });

  it("writes this machine's file with a notice when no app URL is set", async () => {
    const app = await startTestApp();

    const result = await tome(["import", await workspace()], app.root, { HOME: await homeWithConfig({}) });

    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/^No app URL set .*; wrote the events to .*\.agent-box\.jsonl instead\.$/);
    expect(Object.keys(await eventsIn(app.root))).toEqual([`${month()}.agent-box.jsonl`]);
  });
});

describe("tome import", () => {
  it("takes the slug and name from flags", async () => {
    const app = await startTestApp();

    const result = await tome(["import", await workspace(), "--slug", "dits-and-dahs", "--name", "Dits and dahs"], app.root, {
      HOME: await homeWithConfig({}),
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(await readFile(join(app.root, "subjects/dits-and-dahs/subject.json"), "utf8"))).toEqual({ name: "Dits and dahs" });
    expect(Object.values(await eventsIn(app.root, "subjects/dits-and-dahs")).flat()).toEqual(completed("dits-and-dahs"));
  });

  it("prints a checklist of what the agent still has to convert", async () => {
    const app = await startTestApp();

    const result = await tome(["import", await workspace()], app.root, { HOME: await homeWithConfig({}) });

    expect(result.stdout).toContain(`Imported 4 lessons into ${SUBJECT} (Morse Code), all marked complete.`);
    expect(result.stdout).toMatch(/^- \[ \] Convert the drills .*widgets.*\n.*assets\/listen-drill\.js, assets\/morse\.js/m);
    expect(result.stdout).toMatch(/^- \[ \] Write items .*payload schema/m);
    expect(result.stdout).toMatch(/^- \[ \] Rewrite the lessons .*widgets/m);
    expect(result.stdout).toMatch(/localStorage/);
  });

  it("copies only the teach files, not other things in the workspace", async () => {
    const app = await startTestApp();
    const dir = await workspace();
    await writeFile(join(dir, "scratch.txt"), "not part of teach");
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");

    expect((await tome(["import", dir], app.root, { HOME: await homeWithConfig({}) })).code).toBe(0);

    const files = Object.keys(await snapshot(join(app.root, SUBJECT)));
    expect(files).not.toContain("scratch.txt");
    expect(files.some((file) => file.startsWith(".git"))).toBe(false);
  });

  it("creates subjects/ in a home that has none, as a fresh clone of an empty home does", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "tomewise-cli-bare-")), "learning");
    const HOME = await homeWithConfig({});
    expect((await tome(["init", root, "--timezone", "Europe/London"], tmpdir(), { HOME })).code).toBe(0);
    await rm(join(root, "subjects"), { recursive: true });

    const result = await tome(["import", await workspace()], root, { HOME });

    expect(result.code).toBe(0);
    expect(Object.values(await eventsIn(root)).flat()).toEqual(completed());
    expect((await tome(["validate"], root, { HOME })).code).toBe(0);
  });

  it("refuses to import into a subject that already exists and changes nothing", async () => {
    const app = await startTestApp();
    const before = await snapshot(app.root);

    const result = await tome(["import", await workspace(), "--slug", "morse-code"], app.root, { HOME: await homeWithConfig({}) });

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/subjects\/morse-code already exists/);
    expect(await snapshot(app.root)).toEqual(before);
  });

  it("refuses a slug that isn't lowercase words joined by dashes", async () => {
    const app = await startTestApp();
    const before = await snapshot(app.root);

    const result = await tome(["import", await workspace(), "--slug", "Morse Code"], app.root, { HOME: await homeWithConfig({}) });

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/--slug/);
    expect(await snapshot(app.root)).toEqual(before);
  });

  it("refuses a directory that isn't a teach workspace", async () => {
    const app = await startTestApp();
    const before = await snapshot(app.root);
    const empty = await mkdtemp(join(tmpdir(), "tomewise-empty-"));

    const missing = await tome(["import", join(empty, "nope")], app.root, { HOME: await homeWithConfig({}) });
    const notTeach = await tome(["import", empty], app.root, { HOME: await homeWithConfig({}) });

    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/No directory/);
    expect(notTeach.code).toBe(1);
    expect(notTeach.stderr).toMatch(/isn't a teach workspace/);
    expect(await snapshot(app.root)).toEqual(before);
  });

  it("prints usage without a directory", async () => {
    const app = await startTestApp();

    const result = await tome(["import"], app.root, { HOME: await homeWithConfig({}) });

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/tome import <dir>/);
  });
});
