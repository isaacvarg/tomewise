import { describe, expect, it } from "vitest";
import { dueQuiz, loadLearningHome, loadSubject, readEvents } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SUBJECT = "morse-code";

let counter = 0;
const nextId = () => `01KQD${String(++counter).padStart(21, "0")}`;

function completed(ts: string, lesson: string) {
  return { id: nextId(), ts, subject: SUBJECT, kind: "lesson.completed", ref: `lesson:${lesson}`, schemaVersion: 1 };
}

function quizEnded(ts: string, ref = "drill:quiz-2026-11-04", scored = true) {
  const sessionId = nextId();
  return [
    { id: sessionId, ts, subject: SUBJECT, kind: "session.start", ref, sessionId, schemaVersion: 1 },
    { id: nextId(), ts, subject: SUBJECT, kind: "session.end", ref, sessionId, schemaVersion: 1, duration: 60000, ...(scored && { score: 50 }) },
  ];
}

function practised(ts: string) {
  const sessionId = nextId();
  return { id: sessionId, ts, subject: SUBJECT, kind: "session.start", ref: "drill:review", sessionId, schemaVersion: 1 };
}

const LESSONS = ["0001-k-and-m", "0002-r", "0003-s", "0004-u", "0005-a"];

async function dueAt(now: string, events: object[], assessments: Record<string, unknown>, home: Record<string, unknown> = {}) {
  const root = await buildHome({
    "tomewise.json": { formatVersion: 1, timezone: "UTC", ...home },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code", settings: { assessments } },
    ...Object.fromEntries(LESSONS.map((lesson) => [`subjects/${SUBJECT}/lessons/${lesson}.html`, `<h1>${lesson}</h1>`])),
    "subjects/morse-code/quizzes/after-r.html": "<h1>Quiz</h1>",
    [`subjects/${SUBJECT}/events/2026-11.jsonl`]: events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  });
  const learningHome = await loadLearningHome(root);
  return dueQuiz(await loadSubject(learningHome, SUBJECT), await readEvents(learningHome, SUBJECT), new Date(now));
}

describe("a quiz every N lessons", () => {
  const every2 = { quizFrequency: { every: 2 } };

  it("comes due when the Nth lesson is completed", async () => {
    const first = completed("2026-11-02T09:00:00.000Z", "0001-k-and-m");
    const second = completed("2026-11-03T09:00:00.000Z", "0002-r");

    expect(await dueAt("2026-11-05T00:00:00.000Z", [first], every2)).toBeUndefined();
    expect(await dueAt("2026-11-05T00:00:00.000Z", [first, second], every2)).toEqual({
      opened: "2026-11-03T09:00:00.000Z",
      after: "lesson:0002-r",
    });
  });

  it("counts a lesson completed twice once", async () => {
    const again = [completed("2026-11-02T09:00:00.000Z", "0001-k-and-m"), completed("2026-11-03T09:00:00.000Z", "0001-k-and-m")];
    expect(await dueAt("2026-11-05T00:00:00.000Z", again, every2)).toBeUndefined();
  });

  it("ignores lessons completed after now", async () => {
    const events = [completed("2026-11-02T09:00:00.000Z", "0001-k-and-m"), completed("2026-11-03T09:00:00.000Z", "0002-r")];
    expect(await dueAt("2026-11-03T08:59:59.999Z", events, every2)).toBeUndefined();
    expect(await dueAt("2026-11-03T09:00:00.000Z", events, every2)).toMatchObject({ after: "lesson:0002-r" });
  });

  it("clears when a quiz is taken, until the next N lessons", async () => {
    const two = [completed("2026-11-02T09:00:00.000Z", "0001-k-and-m"), completed("2026-11-03T09:00:00.000Z", "0002-r")];
    const taken = [...two, ...quizEnded("2026-11-03T10:00:00.000Z")];
    const third = completed("2026-11-04T09:00:00.000Z", "0003-s");
    const fourth = completed("2026-11-05T09:00:00.000Z", "0004-u");

    expect(await dueAt("2026-11-06T00:00:00.000Z", taken, every2)).toBeUndefined();
    expect(await dueAt("2026-11-06T00:00:00.000Z", [...taken, third], every2)).toBeUndefined();
    expect(await dueAt("2026-11-06T00:00:00.000Z", [...taken, third, fourth], every2)).toEqual({
      opened: "2026-11-05T09:00:00.000Z",
      after: "lesson:0004-u",
    });
  });

  it("stays one quiz however many slots were missed", async () => {
    const four = LESSONS.slice(0, 4).map((lesson, index) => completed(`2026-11-0${index + 2}T09:00:00.000Z`, lesson));
    expect(await dueAt("2026-11-06T00:00:00.000Z", four, every2)).toEqual({ opened: "2026-11-05T09:00:00.000Z", after: "lesson:0004-u" });
  });

  it("is not cleared by a quiz taken before it opened, or a session that never ended", async () => {
    const early = [completed("2026-11-02T09:00:00.000Z", "0001-k-and-m"), ...quizEnded("2026-11-02T10:00:00.000Z")];
    const unfinished = quizEnded("2026-11-03T10:00:00.000Z")[0]!;
    const events = [...early, completed("2026-11-03T09:00:00.000Z", "0002-r"), unfinished];
    expect(await dueAt("2026-11-05T00:00:00.000Z", events, every2)).toMatchObject({ after: "lesson:0002-r" });
  });

  it("clears for a quiz stamped after now, as by a device whose clock runs ahead", async () => {
    const events = [
      completed("2026-11-02T09:00:00.000Z", "0001-k-and-m"),
      completed("2026-11-03T09:00:00.000Z", "0002-r"),
      ...quizEnded("2026-11-05T00:00:05.000Z"),
    ];
    expect(await dueAt("2026-11-05T00:00:00.000Z", events, every2)).toBeUndefined();
  });

  it("is not cleared by a quiz left before the end, which closes with no score", async () => {
    const events = [
      completed("2026-11-02T09:00:00.000Z", "0001-k-and-m"),
      completed("2026-11-03T09:00:00.000Z", "0002-r"),
      ...quizEnded("2026-11-03T10:00:00.000Z", "drill:quiz-2026-11-03", false),
    ];
    expect(await dueAt("2026-11-05T00:00:00.000Z", events, every2)).toMatchObject({ after: "lesson:0002-r" });
  });

  it("clears for a written quiz too", async () => {
    const events = [
      completed("2026-11-02T09:00:00.000Z", "0001-k-and-m"),
      completed("2026-11-03T09:00:00.000Z", "0002-r"),
      ...quizEnded("2026-11-03T10:00:00.000Z", "quiz:after-r"),
    ];
    expect(await dueAt("2026-11-05T00:00:00.000Z", events, every2)).toBeUndefined();
  });
});

describe("a weekly quiz", () => {
  const weekly = { quizFrequency: "weekly" };
  const newYork = { timezone: "America/New_York", weekStart: "wednesday" };
  const before = [practised("2026-11-02T15:00:00.000Z")];

  it("comes due at the start of the week in the learner's timezone", async () => {
    expect(await dueAt("2026-11-04T04:59:59.999Z", before, weekly, newYork)).toBeUndefined();
    expect(await dueAt("2026-11-04T05:00:00.000Z", before, weekly, newYork)).toEqual({ opened: "2026-11-04T05:00:00.000Z" });
    expect(await dueAt("2026-11-09T12:00:00.000Z", before, weekly, newYork)).toEqual({ opened: "2026-11-04T05:00:00.000Z" });
  });

  it("follows weekStart", async () => {
    expect(await dueAt("2026-11-03T12:00:00.000Z", before, weekly, { weekStart: "tuesday" })).toEqual({ opened: "2026-11-03T00:00:00.000Z" });
    expect(await dueAt("2026-11-03T12:00:00.000Z", before, weekly, { weekStart: "wednesday" })).toBeUndefined();
  });

  it("clears when a quiz is taken, until next week", async () => {
    const taken = [...before, ...quizEnded("2026-11-05T12:00:00.000Z")];
    expect(await dueAt("2026-11-10T12:00:00.000Z", taken, weekly, newYork)).toBeUndefined();
    expect(await dueAt("2026-11-11T05:00:00.000Z", taken, weekly, newYork)).toEqual({ opened: "2026-11-11T05:00:00.000Z" });
  });

  it("counts the learner as started from their first session, not the agent's events", async () => {
    const agentFirst = { id: nextId(), ts: "2026-11-02T15:00:00.000Z", subject: SUBJECT, kind: "milestone.status", ref: "milestone:first", schemaVersion: 1, data: { status: "current" } };
    expect(await dueAt("2026-11-10T12:00:00.000Z", [agentFirst, practised("2026-11-05T15:00:00.000Z")], weekly, newYork)).toBeUndefined();
  });

  it("waits for a week that began after the learner started", async () => {
    expect(await dueAt("2026-11-04T12:00:00.000Z", [practised("2026-11-04T06:00:00.000Z")], weekly, newYork)).toBeUndefined();
    expect(await dueAt("2026-11-04T12:00:00.000Z", [], weekly, newYork)).toBeUndefined();
  });
});

describe("no quiz comes due", () => {
  const events = [...LESSONS.map((lesson) => completed("2026-11-02T09:00:00.000Z", lesson)), practised("2026-11-01T09:00:00.000Z")];

  it.each([
    ["on demand", { quizFrequency: "onDemand" }],
    ["assessments are off, every N lessons", { enabled: false, quizFrequency: { every: 1 } }],
    ["assessments are off, weekly", { enabled: false, quizFrequency: "weekly" }],
  ])("when %s", async (_, assessments) => {
    expect(await dueAt("2026-11-20T12:00:00.000Z", events, assessments)).toBeUndefined();
  });
});
