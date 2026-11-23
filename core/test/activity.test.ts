import { describe, expect, it } from "vitest";
import { InvalidLearningHomeError, loadLearningHome, readActivity, validateLearningHome } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SUBJECT = "morse-code";
let counter = 0;

function nextId(): string {
  counter += 1;
  return `01KAJ${String(counter).padStart(21, "0")}`;
}

type Line = Record<string, unknown> & { ts: string };

function session(start: string, minutes: number): Line[] {
  const id = nextId();
  const base = { subject: SUBJECT, ref: "lesson:0001-k-and-m", sessionId: id, schemaVersion: 1 };
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
  return [
    { id, ts: start, kind: "session.start", ...base },
    { id: nextId(), ts: end, kind: "session.end", duration: Math.round(minutes * 60_000), ...base },
  ];
}

function change(kind: "goal.changed" | "streak.changed", ts: string, data: unknown): Line[] {
  return [{ id: nextId(), ts, subject: SUBJECT, kind, schemaVersion: 1, data }];
}

function eventFiles(lines: Line[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const line of lines) {
    const file = `subjects/${SUBJECT}/events/${line.ts.slice(0, 7)}.jsonl`;
    files[file] = `${files[file] ?? ""}${JSON.stringify(line)}\n`;
  }
  return files;
}

interface HomeOptions {
  config?: Record<string, unknown>;
  subject?: Record<string, unknown>;
  events: Line[][];
}

async function home({ config = {}, subject = {}, events }: HomeOptions) {
  const root = await buildHome({
    "tomewise.json": { formatVersion: 1, timezone: "Europe/London", ...config },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code", ...subject },
    [`subjects/${SUBJECT}/lessons/0001-k-and-m.html`]: "<h1>K and M</h1>",
    ...eventFiles(events.flat()),
  });
  expect(await validateLearningHome(root)).toEqual([]);
  return loadLearningHome(root);
}

function dates(activity: { days: { date: string }[] }): string[] {
  return activity.days.map((day) => day.date);
}

describe("activity days", () => {
  it("counts a session that crosses midnight on the day it started only", async () => {
    const learningHome = await home({ events: [session("2026-11-20T23:50:00.000Z", 20)] });

    const activity = await readActivity(learningHome, { now: new Date("2026-11-21T12:00:00.000Z") });

    expect(activity.days).toEqual([{ date: "2026-11-20", subjects: [SUBJECT], minutes: 20 }]);
  });

  it("puts the same UTC timestamps on different days in different timezones", async () => {
    const events = [session("2026-11-20T23:30:00.000Z", 10)];
    const now = new Date("2026-11-22T12:00:00.000Z");

    const london = await readActivity(await home({ events }), { now });
    const auckland = await readActivity(await home({ config: { timezone: "Pacific/Auckland" }, events }), { now });

    expect(dates(london)).toEqual(["2026-11-20"]);
    expect(dates(auckland)).toEqual(["2026-11-21"]);
  });

  it("doesn't make an activity day from a session under the minimum length", async () => {
    const learningHome = await home({
      subject: { settings: { minimumSessionSeconds: 120 } },
      events: [session("2026-11-18T18:00:00.000Z", 1.99), session("2026-11-19T18:00:00.000Z", 2)],
    });

    const activity = await readActivity(learningHome, { now: new Date("2026-11-20T12:00:00.000Z") });

    expect(dates(activity)).toEqual(["2026-11-19"]);
  });

  it("measures a session with no session.end up to its last event", async () => {
    const abandoned = (ts: string, lastEventAfterMinutes?: number): Line[] => {
      const start = session(ts, 0)[0]!;
      if (lastEventAfterMinutes === undefined) return [start];
      const later = new Date(Date.parse(ts) + lastEventAfterMinutes * 60_000).toISOString();
      return [start, { ...start, id: nextId(), ts: later, kind: "lesson.completed" }];
    };
    const learningHome = await home({
      events: [abandoned("2026-11-18T18:00:00.000Z"), abandoned("2026-11-19T18:00:00.000Z", 5)],
    });

    const activity = await readActivity(learningHome, { now: new Date("2026-11-20T12:00:00.000Z") });

    expect(dates(activity)).toEqual(["2026-11-19"]);
  });
});

describe("streaks", () => {
  const monday = (day: number, time = "18:00") => `2026-11-${String(day).padStart(2, "0")}T${time}:00.000Z`;

  it("keeps the streak through rest days within the weekly allowance", async () => {
    const learningHome = await home({
      config: { streak: { restDaysPerWeek: 2 } },
      events: [16, 17, 19, 21].map((day) => session(monday(day), 10)),
    });

    const activity = await readActivity(learningHome, { now: new Date(monday(22, "12:00")) });

    expect(activity.streak).toEqual({ days: 4, restDaysLeft: 0 });
  });

  it("breaks the streak on one rest day more than the allowance", async () => {
    const learningHome = await home({
      config: { streak: { restDaysPerWeek: 2 } },
      events: [16, 17, 19, 22].map((day) => session(monday(day), 10)),
    });

    const activity = await readActivity(learningHome, { now: new Date(monday(22, "19:00")) });

    expect(activity.streak).toEqual({ days: 1, restDaysLeft: 2 });
  });

  it("groups rest days into weeks starting on the configured day", async () => {
    const events = [13, 14, 17].map((day) => session(monday(day), 10));
    const now = new Date(monday(17, "19:00"));

    const mondayStart = await readActivity(await home({ config: { streak: { restDaysPerWeek: 1 } }, events }), { now });
    const sundayStart = await readActivity(
      await home({ config: { weekStart: "sunday", streak: { restDaysPerWeek: 1 } }, events }),
      { now },
    );

    expect(mondayStart.streak.days).toBe(3);
    expect(sundayStart.streak.days).toBe(1);
  });

  it("doesn't break the streak on a day that isn't over yet", async () => {
    const learningHome = await home({ events: [20, 21].map((day) => session(monday(day), 10)) });

    const activity = await readActivity(learningHome, { now: new Date(monday(22, "09:00")) });

    expect(activity.streak.days).toBe(2);
  });

  it("judges rest days before a tightened allowance by the allowance then", async () => {
    const learningHome = await home({
      config: { streak: { restDaysPerWeek: 0 } },
      events: [
        session(monday(16), 10),
        session(monday(19), 10),
        change("streak.changed", monday(20, "09:00"), { from: { restDaysPerWeek: 2 }, to: { restDaysPerWeek: 0 } }),
        session(monday(20), 10),
      ],
    });

    const activity = await readActivity(learningHome, { now: new Date(monday(20, "20:00")) });

    expect(activity.streak).toEqual({ days: 3, restDaysLeft: 0 });
  });

  it("judges one subject's streak by rule changes recorded in any subject", async () => {
    const yoga = (lines: Line[]) => lines.map((line) => ({ ...line, subject: "yoga" }));
    const root = await buildHome({
      "tomewise.json": { formatVersion: 1, timezone: "Europe/London", streak: { restDaysPerWeek: 0 } },
      [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code" },
      "subjects/yoga/subject.json": { name: "Yoga" },
      "subjects/yoga/lessons/0001-k-and-m.html": "<h1>Sun salute</h1>",
      ...eventFiles(change("streak.changed", monday(20, "09:00"), { from: { restDaysPerWeek: 2 }, to: { restDaysPerWeek: 0 } })),
      "subjects/yoga/events/2026-11.jsonl": [16, 19, 20]
        .flatMap((day) => yoga(session(monday(day), 10)))
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    });
    expect(await validateLearningHome(root)).toEqual([]);

    const activity = await readActivity(await loadLearningHome(root), { subject: "yoga", now: new Date(monday(20, "20:00")) });

    expect(dates(activity)).toEqual(["2026-11-16", "2026-11-19", "2026-11-20"]);
    expect(activity.streak).toEqual({ days: 3, restDaysLeft: 0 });
  });
});

describe("goals", () => {
  const day = (n: number, time = "18:00") => `2026-11-${n}T${time}:00.000Z`;

  it("judges each day by the goal in force that day", async () => {
    const tenMinutes = { id: "daily-copy", per: "day", minutes: 10 };
    const twentyMinutes = { ...tenMinutes, minutes: 20 };
    const learningHome = await home({
      subject: { goals: [twentyMinutes] },
      events: [
        session(day(16), 15),
        session(day(17), 15),
        change("goal.changed", day(18, "08:00"), { from: [tenMinutes], to: [twentyMinutes] }),
        session(day(18), 15),
      ],
    });

    const activity = await readActivity(learningHome, { now: new Date(day(18, "20:00")) });

    expect(activity.goals.map(({ from, goal, met }) => ({ from, minutes: goal.minutes, met }))).toEqual([
      { from: "2026-11-16", minutes: 10, met: true },
      { from: "2026-11-17", minutes: 10, met: true },
      { from: "2026-11-18", minutes: 20, met: false },
    ]);
  });

  it("adds up a weekly goal over the week", async () => {
    const learningHome = await home({
      subject: { goals: [{ id: "weekly-copy", per: "week", minutes: 30 }] },
      events: [session(day(13), 10), session(day(16), 20), session(day(19), 10)],
    });

    const activity = await readActivity(learningHome, { now: new Date(day(20, "20:00")) });

    expect(activity.goals).toEqual([
      {
        subject: SUBJECT,
        goal: { id: "weekly-copy", per: "week", minutes: 30 },
        from: "2026-11-09",
        to: "2026-11-15",
        minutes: 10,
        met: false,
      },
      {
        subject: SUBJECT,
        goal: { id: "weekly-copy", per: "week", minutes: 30 },
        from: "2026-11-16",
        to: "2026-11-22",
        minutes: 30,
        met: true,
      },
    ]);
  });
});

describe("date range", () => {
  const day = (n: number, time = "18:00") => `2026-11-${n}T${time}:00.000Z`;

  it("reads activity as of the end of the range", async () => {
    const learningHome = await home({ events: [16, 17, 19].map((n) => session(day(n), 10)) });

    const activity = await readActivity(learningHome, { to: "2026-11-17", now: new Date(day(21)) });

    expect(activity.today).toBe("2026-11-17");
    expect(dates(activity)).toEqual(["2026-11-16", "2026-11-17"]);
    expect(activity.streak.days).toBe(2);
  });

  it("leaves out days and goal periods that end before the start of the range", async () => {
    const learningHome = await home({
      subject: { goals: [{ id: "daily-copy", per: "day", minutes: 10 }, { id: "weekly-copy", per: "week", minutes: 30 }] },
      events: [15, 16, 17, 18].map((n) => session(day(n), 10)),
    });

    const activity = await readActivity(learningHome, { from: "2026-11-17", to: "2026-11-18" });

    expect(dates(activity)).toEqual(["2026-11-17", "2026-11-18"]);
    expect(activity.goals.map(({ goal, from, to }) => `${goal.id} ${from}..${to}`)).toEqual([
      "weekly-copy 2026-11-16..2026-11-22",
      "daily-copy 2026-11-17..2026-11-17",
      "daily-copy 2026-11-18..2026-11-18",
    ]);
    expect(activity.streak.days).toBe(4);
  });

  it("rejects a date that isn't YYYY-MM-DD", async () => {
    const learningHome = await home({ events: [] });

    await expect(readActivity(learningHome, { from: "17/11/2026" })).rejects.toThrow(
      new RangeError("Not a date: 17/11/2026; use YYYY-MM-DD"),
    );
  });
});

describe("rule changes", () => {
  it("rejects a goal.changed or streak.changed without the rules it replaced", async () => {
    const root = await buildHome({
      "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
      [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code" },
      ...eventFiles([
        ...change("goal.changed", "2026-11-18T08:00:00.000Z", { to: [] }),
        ...change("streak.changed", "2026-11-18T09:00:00.000Z", { from: { restDaysPerWeek: 9 }, to: {} }),
      ]),
    });

    const issues = await validateLearningHome(root);

    expect(issues.map(({ line, path }) => ({ line, path }))).toEqual([
      { line: 1, path: "data.from" },
      { line: 2, path: "data.from.restDaysPerWeek" },
      { line: 2, path: "data.to.restDaysPerWeek" },
    ]);
    await expect(readActivity(await loadLearningHome(root))).rejects.toBeInstanceOf(InvalidLearningHomeError);
  });
});
