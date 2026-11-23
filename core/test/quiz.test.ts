import { describe, expect, it } from "vitest";
import { appendEvent, loadLearningHome, quizDrill, quizItems } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SUBJECT = "spanish";
const NOW = new Date("2026-11-22T12:00:00.000Z");

let counter = 0;
const nextId = () => `01KQZ${String(++counter).padStart(21, "0")}`;

function attempt(ts: string, item: string, grade: number) {
  const outcome = grade === 1 ? "wrong" : "correct";
  return { id: nextId(), ts, subject: SUBJECT, kind: "attempt", ref: `item:${item}`, sessionId: "01KQZ5E55100000000000000AB", outcome, grade, schemaVersion: 1 };
}

function completed(ts: string, lesson: string) {
  return { id: nextId(), ts, subject: SUBJECT, kind: "lesson.completed", ref: `lesson:${lesson}`, schemaVersion: 1 };
}

const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "flashcard", front: id, back: id.toUpperCase(), ...extra });

async function quiz(items: unknown[], events: unknown[], quizLength: number) {
  const root = await buildHome({
    "tomewise.json": { formatVersion: 1, timezone: "UTC", assessments: { quizLength } },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Spanish" },
    [`subjects/${SUBJECT}/lessons/0001-basics.html`]: "<h1>Basics</h1>",
    [`subjects/${SUBJECT}/items/vocab.json`]: items,
    [`subjects/${SUBJECT}/events/2026-11.jsonl`]: events.map((event) => `${JSON.stringify(event)}\n`).join(""),
  });
  return (await quizItems(await loadLearningHome(root), SUBJECT, NOW)).map((item) => item.id);
}

const reviewedWell = (item: string, ts = "2026-11-21T09:00:00.000Z") => attempt(ts, item, 4);

describe("an app-built quiz", () => {
  it("takes about a quarter from items missed in the last 30 days, most recent first, and fills with the weakest", async () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => card(id));
    const events = [
      attempt("2026-11-10T09:00:00.000Z", "a", 1),
      attempt("2026-11-20T09:00:00.000Z", "b", 1),
      attempt("2026-11-15T09:00:00.000Z", "c", 1),
      reviewedWell("a", "2026-11-21T09:00:00.000Z"),
      reviewedWell("b", "2026-11-21T09:00:00.000Z"),
      reviewedWell("c", "2026-11-21T09:00:00.000Z"),
      reviewedWell("d", "2026-11-01T09:00:00.000Z"),
      reviewedWell("e", "2026-11-21T09:00:00.000Z"),
      reviewedWell("f", "2026-11-21T11:00:00.000Z"),
      reviewedWell("g", "2026-11-21T11:00:00.000Z"),
    ];

    expect(await quiz(items, events, 8)).toEqual(["b", "c", "h", "a", "d", "e", "f", "g"]);
    expect(await quiz(items, events, 4)).toEqual(["b", "h", "c", "a"]);
  });

  it("leaves out misses older than 30 days, so they compete as weak items only", async () => {
    const items = ["missed", "new-1", "new-2", "new-3"].map((id) => card(id));
    const quizWith = (missedAt: string) => quiz(items, [attempt(missedAt, "missed", 1)], 4);

    expect(await quizWith("2026-10-23T12:00:00.000Z")).toEqual(["missed", "new-1", "new-2", "new-3"]);
    expect(await quizWith("2026-10-23T11:59:00.000Z")).toEqual(["new-1", "new-2", "new-3", "missed"]);
  });

  it("names a missed item once, however often it was missed", async () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => card(id));
    const events = [
      attempt("2026-11-18T09:00:00.000Z", "a", 1),
      attempt("2026-11-19T09:00:00.000Z", "a", 1),
      attempt("2026-11-20T09:00:00.000Z", "a", 1),
      ...["b", "c", "d", "e", "f", "g", "h"].map((id) => reviewedWell(id)),
    ];

    const picked = await quiz(items, events, 8);
    expect(picked[0]).toBe("a");
    expect(new Set(picked).size).toBe(picked.length);
    expect(picked).toHaveLength(8);
  });

  it("is shorter when too few items are unlocked", async () => {
    const items = [card("a"), card("b"), card("locked", { unlockedBy: "0001-basics" }), card("gone", { retired: true })];
    const events = [attempt("2026-11-20T09:00:00.000Z", "a", 1)];

    expect(await quiz(items, events, 10)).toEqual(["a", "b"]);
    expect(await quiz(items, [...events, completed("2026-11-21T09:00:00.000Z", "0001-basics")], 10)).toEqual(["a", "b", "locked"]);
  });

  it("ignores attempts after now", async () => {
    const items = ["a", "b", "c", "d"].map((id) => card(id));
    const events = ["a", "b", "c"].map((id) => reviewedWell(id)).concat(attempt("2026-11-22T13:00:00.000Z", "d", 1));

    expect(await quiz(items, events, 4)).toEqual(["d", "a", "b", "c"]);
    expect(await quiz(items, [...events, attempt("2026-11-22T11:00:00.000Z", "c", 1)], 4)).toEqual(["c", "d", "a", "b"]);
  });

  it("runs as a scored drill named for the day, timed when the settings say", () => {
    expect(quizDrill("2026-11-22", 10, { timed: false })).toEqual({
      id: "quiz-2026-11-22",
      builtIn: true,
      quiz: true,
      name: "Quiz",
      select: { from: "unlocked", tags: [] },
      count: 10,
      format: "item",
    });
    expect(quizDrill("2026-11-22", 10, { timed: { minutes: 1.5 } }).timeLimits).toEqual({ totalSeconds: 90 });
  });

  it("records sessions under drill:quiz-<date> without a drill file", async () => {
    const root = await buildHome({
      "tomewise.json": { formatVersion: 1, timezone: "UTC" },
      [`subjects/${SUBJECT}/subject.json`]: { name: "Spanish" },
      [`subjects/${SUBJECT}/items/vocab.json`]: [card("a")],
    });
    const home = await loadLearningHome(root);
    const start = (ref: string) => appendEvent(home, { subject: SUBJECT, schemaVersion: 1, kind: "session.start", ref, data: {} }, { target: { machine: "laptop" } });

    await expect(start("drill:quiz-2026-11-22")).resolves.toMatchObject({ event: { ref: "drill:quiz-2026-11-22" } });
    await expect(start("drill:quiz-today")).rejects.toThrow('No drill "quiz-today"');
    expect(() => quizDrill("today", 1, { timed: false })).toThrow(RangeError);
  });
});
