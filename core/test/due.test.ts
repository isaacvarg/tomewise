import { describe, expect, it } from "vitest";
import { dueItems, loadLearningHome } from "@tomewise/core";
import { buildHome, snapshot } from "./helpers.ts";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `01KAJ${String(counter).padStart(21, "0")}`;
}

const SUBJECT = "morse-code";

function sessionStart(ts: string, ref: string) {
  const id = nextId();
  return { id, ts, subject: SUBJECT, kind: "session.start", ref, sessionId: id, schemaVersion: 1 };
}

function attempt(ts: string, item: string, grade: number, sessionId: string) {
  const outcome = grade === 1 ? "wrong" : "correct";
  return { id: nextId(), ts, subject: SUBJECT, kind: "attempt", ref: `item:${item}`, sessionId, outcome, grade, schemaVersion: 1 };
}

function completed(ts: string, lesson: string) {
  return { id: nextId(), ts, subject: SUBJECT, kind: "lesson.completed", ref: `lesson:${lesson}`, schemaVersion: 1 };
}

function jsonl(...events: unknown[]): string {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

function letter(id: string, unlockedBy: string, extra: Record<string, unknown> = {}) {
  return { id, type: "timed-audio", prompt: id, answer: id.slice(-1).toUpperCase(), unlockedBy, ...extra };
}

function home(events: Record<string, string>, extraItems: unknown[] = [], timezone = "UTC") {
  return buildHome({
    "tomewise.json": { formatVersion: 1, timezone },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code" },
    [`subjects/${SUBJECT}/lessons/0001-k-and-m.html`]: "<h1>K and M</h1>",
    [`subjects/${SUBJECT}/lessons/0002-r.html`]: "<h1>R</h1>",
    [`subjects/${SUBJECT}/items/0001-k-and-m.json`]: [letter("letter-k", "0001-k-and-m"), letter("letter-m", "0001-k-and-m")],
    [`subjects/${SUBJECT}/items/0002-r.json`]: [letter("letter-r", "0002-r"), ...extraItems],
    ...Object.fromEntries(Object.entries(events).map(([month, text]) => [`subjects/${SUBJECT}/events/${month}.jsonl`, text])),
  });
}

async function due(root: string, on: Date | string) {
  const items = await dueItems(await loadLearningHome(root), SUBJECT, on);
  return items.map(({ item, due }) => [item.id, due]);
}

describe("what's due", () => {
  it("schedules each item by replaying its graded attempts through FSRS", async () => {
    const review = sessionStart("2026-11-01T08:59:00.000Z", "drill:review");
    const again = sessionStart("2026-11-07T08:59:00.000Z", "drill:review");
    const root = await home({
      "2026-10": jsonl(completed("2026-10-31T12:00:00.000Z", "0001-k-and-m")),
      "2026-11": jsonl(
        review,
        attempt("2026-11-01T09:00:00.000Z", "letter-k", 3, review.id),
        attempt("2026-11-01T09:00:10.000Z", "letter-m", 4, review.id),
        again,
        attempt("2026-11-07T09:00:00.000Z", "letter-k", 3, again.id),
      ),
    });

    expect(await due(root, "2026-11-05")).toEqual([]);
    expect(await due(root, "2026-11-06")).toEqual([["letter-k", "2026-11-06T03:39:55.164Z"]]);
    expect(await due(root, "2026-11-07")).toEqual([]);
    expect(await due(root, "2026-12-04")).toEqual([]);
    expect(await due(root, "2026-12-05")).toEqual([["letter-k", "2026-12-05T11:28:23.574Z"]]);
    expect(await due(root, "2026-12-25")).toEqual([
      ["letter-k", "2026-12-05T11:28:23.574Z"],
      ["letter-m", "2026-12-25T05:52:15.937Z"],
    ]);
  });

  it("brings a missed item back the same day", async () => {
    const first = sessionStart("2026-11-01T08:59:00.000Z", "drill:review");
    const second = sessionStart("2026-11-06T08:59:00.000Z", "drill:review");
    const root = await home({
      "2026-10": jsonl(completed("2026-10-31T12:00:00.000Z", "0001-k-and-m")),
      "2026-11": jsonl(
        first,
        attempt("2026-11-01T09:00:00.000Z", "letter-k", 3, first.id),
        attempt("2026-11-01T09:00:10.000Z", "letter-m", 4, first.id),
        second,
        attempt("2026-11-06T09:00:00.000Z", "letter-k", 1, second.id),
      ),
    });

    expect(await due(root, "2026-11-06")).toEqual([["letter-k", "2026-11-06T09:10:00.000Z"]]);
  });

  it("judges the date in the learning home's timezone", async () => {
    const review = sessionStart("2026-11-01T08:59:00.000Z", "drill:review");
    const root = await home(
      {
        "2026-10": jsonl(completed("2026-10-31T12:00:00.000Z", "0001-k-and-m")),
        "2026-11": jsonl(
          review,
          attempt("2026-11-01T09:00:00.000Z", "letter-k", 3, review.id),
          attempt("2026-11-01T09:00:10.000Z", "letter-m", 4, review.id),
        ),
      },
      [],
      "America/New_York",
    );

    expect(await due(root, "2026-11-05")).toEqual([["letter-k", "2026-11-06T03:39:55.164Z"]]);
    expect(await due(root, new Date("2026-11-06T03:00:00.000Z"))).toEqual([["letter-k", "2026-11-06T03:39:55.164Z"]]);
  });

  it("keeps items out until their unlocking lesson is completed, then makes them due", async () => {
    const check = sessionStart("2026-11-03T18:00:00.000Z", "lesson:0002-r");
    const root = await home({
      "2026-11": jsonl(
        completed("2026-11-01T12:00:00.000Z", "0001-k-and-m"),
        check,
        attempt("2026-11-03T18:05:00.000Z", "letter-r", 1, check.id),
        completed("2026-11-03T18:10:00.000Z", "0002-r"),
      ),
    });

    expect(await due(root, "2026-10-31")).toEqual([]);
    expect(await due(root, "2026-11-01")).toEqual([
      ["letter-k", "2026-11-01T12:00:00.000Z"],
      ["letter-m", "2026-11-01T12:00:00.000Z"],
    ]);
    expect((await due(root, "2026-11-02")).map(([id]) => id)).toEqual(["letter-k", "letter-m"]);
    expect(await due(root, "2026-11-03")).toEqual([
      ["letter-k", "2026-11-01T12:00:00.000Z"],
      ["letter-m", "2026-11-01T12:00:00.000Z"],
      ["letter-r", "2026-11-03T18:06:00.000Z"],
    ]);
  });

  it("never makes routines due, even with attempts logged", async () => {
    const session = sessionStart("2026-11-01T08:59:00.000Z", "lesson:0002-r");
    const routine = {
      id: "warm-up",
      type: "routine",
      name: "Warm-up",
      steps: [{ text: "Copy five random letters" }],
      unlockedBy: "0002-r",
    };
    const root = await home(
      {
        "2026-11": jsonl(
          completed("2026-11-01T08:00:00.000Z", "0002-r"),
          session,
          attempt("2026-11-01T09:00:00.000Z", "warm-up", 1, session.id),
          attempt("2026-11-01T09:00:00.000Z", "letter-r", 4, session.id),
        ),
      },
      [routine],
    );

    expect(await due(root, "2026-11-01")).toEqual([]);
    expect(await due(root, "2027-06-01")).toEqual([["letter-r", expect.any(String)]]);
  });

  it("never makes retired items due", async () => {
    const session = sessionStart("2026-11-01T08:59:00.000Z", "drill:review");
    const retired = letter("letter-r-old", "0002-r", { retired: true });
    const root = await home(
      {
        "2026-11": jsonl(
          completed("2026-11-01T08:00:00.000Z", "0002-r"),
          session,
          attempt("2026-11-01T09:00:00.000Z", "letter-r-old", 1, session.id),
        ),
      },
      [retired],
    );

    expect(await due(root, "2026-11-01")).toEqual([["letter-r", "2026-11-01T08:00:00.000Z"]]);
    expect((await due(root, "2027-06-01")).map(([id]) => id)).toEqual(["letter-r"]);
  });

  it("counts attempts from drills, quizzes and lesson checks the same as reviews", async () => {
    const sessions = (refs: string[]) => {
      const [a, b, c] = refs.map((ref, i) => sessionStart(`2026-11-0${1 + i * 2}T08:59:00.000Z`, ref));
      return jsonl(
        completed("2026-10-31T12:00:00.000Z", "0001-k-and-m"),
        a,
        attempt("2026-11-01T09:00:00.000Z", "letter-k", 3, a!.id),
        b,
        attempt("2026-11-03T09:00:00.000Z", "letter-k", 2, b!.id),
        c,
        attempt("2026-11-05T09:00:00.000Z", "letter-k", 4, c!.id),
      );
    };
    const reviewed = await home({ "2026-11": sessions(["drill:review", "drill:review", "drill:review"]) });
    const mixed = await home({ "2026-11": sessions(["drill:listen-kmrsu", "quiz:week-1", "lesson:0001-k-and-m"]) });

    const fromReviews = await due(reviewed, "2027-06-01");
    expect(fromReviews.find(([id]) => id === "letter-k")?.[1]).not.toBe("2026-10-31T12:00:00.000Z");
    expect(await due(mixed, "2027-06-01")).toEqual(fromReviews);
  });

  it("gives the same answer every time and writes nothing", async () => {
    const session = sessionStart("2026-11-01T08:59:00.000Z", "drill:review");
    const root = await home({
      "2026-11": jsonl(
        completed("2026-11-01T08:00:00.000Z", "0001-k-and-m"),
        session,
        attempt("2026-11-01T09:00:00.000Z", "letter-k", 3, session.id),
      ),
    });
    const before = await snapshot(root);

    const first = await due(root, "2026-11-20");
    const second = await due(root, "2026-11-20");

    expect(second).toEqual(first);
    expect(first.map(([id]) => id)).toEqual(["letter-m", "letter-k"]);
    expect(await snapshot(root)).toEqual(before);
  });
});
