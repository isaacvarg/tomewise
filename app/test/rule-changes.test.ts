import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFiles } from "../../core/test/helpers.ts";
import { startTestApp } from "./harness.ts";

const SUBJECT_JSON = "subjects/morse-code/subject.json";
const CONFIG = { formatVersion: 1, timezone: "Europe/London", weekStart: "monday", minimumSessionSeconds: 60 };
const tenMinutes = { id: "daily", per: "day", minutes: 10 };
const twentyMinutes = { id: "daily", per: "day", minutes: 20 };

function poll<T>(read: () => Promise<T>) {
  return expect.poll(read, { timeout: 3000, interval: 25 });
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

async function setGoals(root: string, goals: unknown[]) {
  const subject = JSON.parse(await readFile(join(root, SUBJECT_JSON), "utf8"));
  await writeFile(join(root, SUBJECT_JSON), JSON.stringify({ ...subject, goals }, null, 2));
}

async function setStreak(root: string, restDaysPerWeek: number) {
  await writeFiles(root, { "tomewise.json": { ...CONFIG, streak: { restDaysPerWeek } } });
}

async function ruleEvents(root: string, subject: string, kind: "goal.changed" | "streak.changed") {
  const dir = join(root, "subjects", subject, "events");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const events = [];
  for (const name of names.sort()) {
    for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) {
      if (line === "") continue;
      const event = JSON.parse(line);
      if (event.kind === kind) events.push({ file: name, ...event });
    }
  }
  return events;
}

function mainFile() {
  return `${new Date().toISOString().slice(0, 7)}.jsonl`;
}

async function addFlags(root: string) {
  await writeFiles(root, { "subjects/flags/subject.json": { name: "Flags" } });
}

describe("goal.changed", () => {
  it("is appended once when a subject's goals change", async () => {
    const app = await startTestApp();

    await setGoals(app.root, [tenMinutes]);

    await poll(async () => (await ruleEvents(app.root, "morse-code", "goal.changed")).length).toBe(1);
    const [event] = await ruleEvents(app.root, "morse-code", "goal.changed");
    expect(event).toMatchObject({
      file: mainFile(),
      subject: "morse-code",
      kind: "goal.changed",
      schemaVersion: 2,
      data: { from: [], to: [tenMinutes] },
    });
  });

  it("compares against the last goal.changed, not the previous view", async () => {
    const app = await startTestApp((root) => setGoals(root, [tenMinutes]));

    await setGoals(app.root, [twentyMinutes]);
    await poll(async () => (await ruleEvents(app.root, "morse-code", "goal.changed")).length).toBe(1);
    await setGoals(app.root, [tenMinutes]);

    await poll(async () => (await ruleEvents(app.root, "morse-code", "goal.changed")).length).toBe(2);
    const events = await ruleEvents(app.root, "morse-code", "goal.changed");
    expect(events.map((event) => event.data)).toEqual([
      { from: [tenMinutes], to: [twentyMinutes] },
      { from: [twentyMinutes], to: [tenMinutes] },
    ]);
  });

  it("is not appended again when the watcher fires for the same goals", async () => {
    const app = await startTestApp();
    await setGoals(app.root, [tenMinutes]);
    await poll(async () => (await ruleEvents(app.root, "morse-code", "goal.changed")).length).toBe(1);

    await setGoals(app.root, [tenMinutes]);
    await writeFile(join(app.root, "subjects/morse-code/lessons/0005-e.html"), "<!doctype html><title>E</title>");
    await poll(async () => (await app.get("/api/subjects/morse-code")).body.lessons).toContain("0005-e");
    await settle();

    expect(await ruleEvents(app.root, "morse-code", "goal.changed")).toHaveLength(1);
    expect(app.reloadErrors).toEqual([]);
  });

  it("is not appended for goals unchanged since startup", async () => {
    const app = await startTestApp((root) => setGoals(root, [tenMinutes]));

    await writeFile(join(app.root, "subjects/morse-code/lessons/0005-e.html"), "<!doctype html><title>E</title>");
    await poll(async () => (await app.get("/api/subjects/morse-code")).body.lessons).toContain("0005-e");
    await settle();

    expect(await ruleEvents(app.root, "morse-code", "goal.changed")).toEqual([]);
  });

  it("records a change made while the app was down once at startup", async () => {
    const app = await startTestApp();
    await setGoals(app.root, [tenMinutes]);
    await poll(async () => (await ruleEvents(app.root, "morse-code", "goal.changed")).length).toBe(1);

    await app.restart(() => setGoals(app.root, [twentyMinutes]));
    expect(await ruleEvents(app.root, "morse-code", "goal.changed")).toHaveLength(2);
    await app.restart();

    const events = await ruleEvents(app.root, "morse-code", "goal.changed");
    expect(events.map((event) => event.data)).toEqual([
      { from: [], to: [tenMinutes] },
      { from: [tenMinutes], to: [twentyMinutes] },
    ]);
  });

  it("is recorded at startup when the files differ from the last goal.changed", async () => {
    const recorded = {
      id: "01KAJ000000000000000000001",
      ts: "2026-11-01T09:00:00.000Z",
      subject: "morse-code",
      kind: "goal.changed",
      schemaVersion: 2,
      data: { from: [], to: [tenMinutes] },
    };
    const app = await startTestApp(async (root) => {
      await setGoals(root, [twentyMinutes]);
      await writeFile(join(root, "subjects/morse-code/events/2026-09.jsonl"), `${JSON.stringify(recorded)}\n`);
    });

    const events = await ruleEvents(app.root, "morse-code", "goal.changed");
    expect(events.map((event) => event.data)).toEqual([
      { from: [], to: [tenMinutes] },
      { from: [tenMinutes], to: [twentyMinutes] },
    ]);
    await app.restart();
    expect(await ruleEvents(app.root, "morse-code", "goal.changed")).toHaveLength(2);
  });

  it("is appended for the subject whose goals changed", async () => {
    const app = await startTestApp(addFlags);

    await writeFiles(app.root, { "subjects/flags/subject.json": { name: "Flags", goals: [tenMinutes] } });

    await poll(async () => (await ruleEvents(app.root, "flags", "goal.changed")).length).toBe(1);
    expect((await ruleEvents(app.root, "flags", "goal.changed"))[0]).toMatchObject({
      subject: "flags",
      schemaVersion: 1,
      data: { from: [], to: [tenMinutes] },
    });
    expect(await ruleEvents(app.root, "morse-code", "goal.changed")).toEqual([]);
  });

  it("keeps the old goals for days before the change", async () => {
    const app = await startTestApp((root) => setGoals(root, [tenMinutes]));
    const start = new Date(Date.now() - 2 * 86_400_000);
    start.setUTCHours(12, 0, 0, 0);
    const day = start.toISOString().slice(0, 10);
    const session = await app.post({
      subject: "morse-code",
      kind: "session.start",
      ts: start.toISOString(),
      ref: "lesson:0001-k-and-m",
      schemaVersion: 2,
      data: {},
    });
    await app.post({
      subject: "morse-code",
      kind: "session.end",
      ts: new Date(start.getTime() + 15 * 60_000).toISOString(),
      ref: "lesson:0001-k-and-m",
      sessionId: session.body.events[0].id,
      duration: 15 * 60_000,
      schemaVersion: 2,
      data: {},
    });

    await setGoals(app.root, [twentyMinutes]);
    await poll(async () => (await ruleEvents(app.root, "morse-code", "goal.changed")).length).toBe(1);

    const activity = await app.get(`/api/activity?from=${day}`);
    const daily = activity.body.goals.filter((goal: any) => goal.goal.per === "day");
    expect(daily[0]).toMatchObject({ from: day, goal: tenMinutes, minutes: 15, met: true });
    expect(daily.at(-1)).toMatchObject({ to: activity.body.today, goal: twentyMinutes });
  });
});

describe("streak.changed", () => {
  it("is appended once to the first subject alphabetically", async () => {
    const app = await startTestApp(addFlags);

    await setStreak(app.root, 2);

    await poll(async () => (await ruleEvents(app.root, "flags", "streak.changed")).length).toBe(1);
    expect((await ruleEvents(app.root, "flags", "streak.changed"))[0]).toMatchObject({
      file: mainFile(),
      subject: "flags",
      kind: "streak.changed",
      schemaVersion: 1,
      data: { from: { restDaysPerWeek: 0 }, to: { restDaysPerWeek: 2 } },
    });
    expect(await ruleEvents(app.root, "morse-code", "streak.changed")).toEqual([]);
  });

  it("is not appended again when the watcher fires for the same rules", async () => {
    const app = await startTestApp();
    await setStreak(app.root, 1);
    await poll(async () => (await ruleEvents(app.root, "morse-code", "streak.changed")).length).toBe(1);

    await setStreak(app.root, 1);
    await setGoals(app.root, [tenMinutes]);
    await poll(async () => (await ruleEvents(app.root, "morse-code", "goal.changed")).length).toBe(1);
    await settle();

    expect(await ruleEvents(app.root, "morse-code", "streak.changed")).toHaveLength(1);
  });

  it("compares against the last streak.changed in any subject", async () => {
    const app = await startTestApp();
    await setStreak(app.root, 1);
    await poll(async () => (await ruleEvents(app.root, "morse-code", "streak.changed")).length).toBe(1);

    await addFlags(app.root);
    await poll(async () => (await app.get("/api/subjects/flags")).status).toBe(200);
    await app.restart();
    await settle();

    expect(await ruleEvents(app.root, "flags", "streak.changed")).toEqual([]);
    expect(await ruleEvents(app.root, "morse-code", "streak.changed")).toHaveLength(1);
  });

  it("records a change made while the app was down once at startup", async () => {
    const app = await startTestApp();
    await setStreak(app.root, 1);
    await poll(async () => (await ruleEvents(app.root, "morse-code", "streak.changed")).length).toBe(1);

    await app.restart(() => setStreak(app.root, 3));
    expect(await ruleEvents(app.root, "morse-code", "streak.changed")).toHaveLength(2);
    await app.restart();

    const events = await ruleEvents(app.root, "morse-code", "streak.changed");
    expect(events.map((event) => event.data)).toEqual([
      { from: { restDaysPerWeek: 0 }, to: { restDaysPerWeek: 1 } },
      { from: { restDaysPerWeek: 1 }, to: { restDaysPerWeek: 3 } },
    ]);
  });
});
