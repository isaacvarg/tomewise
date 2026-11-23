import { describe, expect, it } from "vitest";
import { dueQuiz, loadLearningHome, loadSubject, quizSlots, readEvents, validateLearningHome } from "@tomewise/core";
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

async function homeWith(events: object[], assessments: Record<string, unknown>, home: Record<string, unknown> = {}, quizzes: Record<string, string> = {}) {
  const root = await buildHome({
    "tomewise.json": { formatVersion: 1, timezone: "UTC", ...home },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code", settings: { assessments } },
    ...Object.fromEntries(LESSONS.map((lesson) => [`subjects/${SUBJECT}/lessons/${lesson}.html`, `<h1>${lesson}</h1>`])),
    "subjects/morse-code/quizzes/after-r.html": "<h1>Quiz</h1>",
    ...Object.fromEntries(Object.entries(quizzes).map(([id, html]) => [`subjects/${SUBJECT}/quizzes/${id}.html`, html])),
    [`subjects/${SUBJECT}/events/2026-11.jsonl`]: events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  });
  const learningHome = await loadLearningHome(root);
  return { root, subject: await loadSubject(learningHome, SUBJECT), events: await readEvents(learningHome, SUBJECT) };
}

async function dueAt(now: string, events: object[], assessments: Record<string, unknown>, home: Record<string, unknown> = {}, quizzes: Record<string, string> = {}) {
  const { subject, events: read } = await homeWith(events, assessments, home, quizzes);
  return dueQuiz(subject, read, new Date(now));
}

const writtenAfter = (lesson: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="tome-after" content="lesson:${lesson}"><title>Quiz</title></head>
<body><h1>Quiz</h1></body></html>`;

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

describe("written quizzes", () => {
  const every2 = { quizFrequency: { every: 2 } };
  const every1 = { quizFrequency: { every: 1 } };
  const weekly = { quizFrequency: "weekly" };
  const two = [completed("2026-11-02T09:00:00.000Z", "0001-k-and-m"), completed("2026-11-03T09:00:00.000Z", "0002-r")];

  it("fills the slot that opens when its lesson is completed", async () => {
    expect(await dueAt("2026-11-05T00:00:00.000Z", two, every2, {}, { "after-r": writtenAfter("0002-r") })).toEqual({
      opened: "2026-11-03T09:00:00.000Z",
      after: "lesson:0002-r",
      quiz: "after-r",
    });
  });

  it("fills the first slot after its lesson, not one before", async () => {
    const quizzes = { "after-k": writtenAfter("0001-k-and-m") };
    expect(await dueAt("2026-11-05T00:00:00.000Z", two, every2, {}, quizzes)).toMatchObject({ quiz: "after-k" });
    expect(await dueAt("2026-11-05T00:00:00.000Z", two, every2, {}, { "after-s": writtenAfter("0003-s") })).toEqual({
      opened: "2026-11-03T09:00:00.000Z",
      after: "lesson:0002-r",
    });
  });

  it("fills a weekly slot that opens after its lesson", async () => {
    const newYork = { timezone: "America/New_York", weekStart: "wednesday" };
    const quizzes = { "after-k": writtenAfter("0001-k-and-m") };
    const before = [practised("2026-11-02T15:00:00.000Z"), completed("2026-11-02T16:00:00.000Z", "0001-k-and-m")];
    expect(await dueAt("2026-11-05T12:00:00.000Z", before, weekly, newYork, quizzes)).toEqual({ opened: "2026-11-04T05:00:00.000Z", quiz: "after-k" });
    const late = [practised("2026-11-02T15:00:00.000Z"), completed("2026-11-05T16:00:00.000Z", "0001-k-and-m")];
    expect(await dueAt("2026-11-05T17:00:00.000Z", late, weekly, newYork, quizzes)).toEqual({ opened: "2026-11-04T05:00:00.000Z" });
    expect(await dueAt("2026-11-11T12:00:00.000Z", late, weekly, newYork, quizzes)).toEqual({ opened: "2026-11-11T05:00:00.000Z", quiz: "after-k" });
  });

  it("is used once it is taken, and the next quiz after the same lesson takes the next slot", async () => {
    const takenA = [two[0]!, ...quizEnded("2026-11-02T10:00:00.000Z", "quiz:a"), two[1]!];
    const now = new Date("2026-11-05T00:00:00.000Z");
    const { subject, events } = await homeWith(takenA, every1, {}, { a: writtenAfter("0001-k-and-m"), b: writtenAfter("0001-k-and-m") });
    expect(quizSlots(subject, events, now)).toEqual([
      { opened: "2026-11-02T09:00:00.000Z", after: "lesson:0001-k-and-m", quiz: "a" },
      { opened: "2026-11-03T09:00:00.000Z", after: "lesson:0002-r", quiz: "b" },
    ]);
    const { subject: one, events: same } = await homeWith(takenA, every1, {}, { a: writtenAfter("0001-k-and-m") });
    expect(quizSlots(one, same, now)).toEqual([
      { opened: "2026-11-02T09:00:00.000Z", after: "lesson:0001-k-and-m", quiz: "a" },
      { opened: "2026-11-03T09:00:00.000Z", after: "lesson:0002-r" },
    ]);
  });

  it("carries a quiz not yet taken to the next slot", async () => {
    expect(await dueAt("2026-11-05T00:00:00.000Z", two, every1, {}, { a: writtenAfter("0001-k-and-m") })).toEqual({
      opened: "2026-11-03T09:00:00.000Z",
      after: "lesson:0002-r",
      quiz: "a",
    });
  });

  it("skips a quiz already taken before its slot opened", async () => {
    const events = [two[0]!, ...quizEnded("2026-11-02T10:00:00.000Z", "quiz:after-k"), two[1]!];
    expect(await dueAt("2026-11-05T00:00:00.000Z", events, every2, {}, { "after-k": writtenAfter("0001-k-and-m") })).toEqual({
      opened: "2026-11-03T09:00:00.000Z",
      after: "lesson:0002-r",
    });
  });

  it("ignores a quiz that declares no lesson", async () => {
    expect(await dueAt("2026-11-05T00:00:00.000Z", two, every2)).toEqual({ opened: "2026-11-03T09:00:00.000Z", after: "lesson:0002-r" });
  });

  it("reads after from the page's metadata", async () => {
    const { subject } = await homeWith([], every2, {}, {
      "after-r": `<head><meta content='lesson:0002-r' name='tome-after'></head>`,
      commented: `<head><!-- <meta name="tome-after" content="lesson:0002-r"> --></head>`,
    });
    expect(subject.quizAfter).toEqual({ "after-r": "lesson:0002-r" });
  });

  it("flags an after that names no lesson of the subject", async () => {
    const root = await buildHome({
      "tomewise.json": { formatVersion: 1, timezone: "UTC" },
      [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code" },
      [`subjects/${SUBJECT}/lessons/0002-r.html`]: "<h1>R</h1>",
      [`subjects/${SUBJECT}/quizzes/fine.html`]: writtenAfter("0002-r"),
      [`subjects/${SUBJECT}/quizzes/stray.html`]: writtenAfter("9999-nope"),
      [`subjects/${SUBJECT}/quizzes/odd.html`]: `<meta name="tome-after" content="drill:review">`,
    });
    expect(await validateLearningHome(root)).toEqual([
      expect.objectContaining({ file: `subjects/${SUBJECT}/quizzes/odd.html`, message: expect.stringContaining("lesson:<id>") }),
      expect.objectContaining({ file: `subjects/${SUBJECT}/quizzes/stray.html`, message: expect.stringContaining("9999-nope") }),
    ]);
  });
});
