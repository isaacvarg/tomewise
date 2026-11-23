import { describe, expect, it } from "vitest";
import {
  appendEvents,
  closeExams,
  examPassMark,
  examQuestions,
  InvalidEventError,
  type LearningEvent,
  loadLearningHome,
  loadSubject,
  milestoneStatusesOf,
  readEvents,
} from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SUBJECT = "morse-code";
const SESSION = "01KAJ0000000000000000000S1";

const EXAM = `<!doctype html>
<h1>First letters</h1>
<tome-exam-question id="q1" tests="item:letter-k item:letter-r"><p>Which is K?</p><tome-choice answer="K"><option>K</option><option>R</option></tome-choice></tome-exam-question>
<tome-exam-question tests="item:letter-r" id='q2'><p>R?</p><tome-typed answer="R"></tome-typed></tome-exam-question>
<tome-exam-question id=q3 tests="item:letter-k"><p>K?</p><tome-typed answer="K"></tome-typed></tome-exam-question>
<tome-exam-question id="q4" tests="item:letter-k"><p>K again?</p><tome-typed answer="K"></tome-typed></tome-exam-question>
`;

interface Options {
  passMark?: number;
  settings?: Record<string, unknown>;
  milestoneStatus?: string;
}

async function home({ passMark, settings, milestoneStatus = "current" }: Options = {}) {
  const root = await buildHome({
    "tomewise.json": { formatVersion: 1, timezone: "UTC", assessments: { passMark: 60 } },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code", ...(settings && { settings: { assessments: settings } }) },
    [`subjects/${SUBJECT}/items/letters.json`]: [
      { id: "letter-k", type: "flashcard", front: "K", back: "-.-" },
      { id: "letter-r", type: "flashcard", front: "R", back: ".-." },
    ],
    [`subjects/${SUBJECT}/exams/first-letters.html`]: EXAM,
    [`subjects/${SUBJECT}/exams/practice.html`]: `<tome-exam-question id="p1" tests="item:letter-k"></tome-exam-question>`,
    [`subjects/${SUBJECT}/curriculum.json`]: {
      units: [
        {
          title: "Koch letters",
          milestones: [
            { id: "first-letters", title: "Copy K and R", status: milestoneStatus, exam: "first-letters", ...(passMark !== undefined && { passMark }) },
            { id: "next", title: "Next letters", status: "upcoming" },
          ],
        },
      ],
    },
  });
  return loadLearningHome(root);
}

let counter = 0;
const nextId = () => `01KAJ${String(++counter).padStart(21, "0")}`;

function start(exam = "first-letters") {
  return { id: SESSION, ts: "2026-11-03T18:00:00.000Z", subject: SUBJECT, kind: "session.start", ref: `exam:${exam}`, sessionId: SESSION, schemaVersion: 1 };
}

function answer(question: string, outcome: "correct" | "wrong", ref = "item:letter-k") {
  return {
    id: nextId(),
    ts: "2026-11-03T18:01:00.000Z",
    subject: SUBJECT,
    kind: "attempt",
    ref,
    sessionId: SESSION,
    outcome,
    grade: outcome === "correct" ? 3 : 1,
    schemaVersion: 1,
    data: { question },
  };
}

function end(exam = "first-letters", extra: Record<string, unknown> = {}) {
  return { ts: "2026-11-03T18:10:00.000Z", subject: SUBJECT, kind: "session.end", ref: `exam:${exam}`, sessionId: SESSION, duration: 600_000, schemaVersion: 1, data: {}, ...extra };
}

async function takeExam(loaded: Awaited<ReturnType<typeof home>>, right: number, exam = "first-letters", extra: Record<string, unknown> = {}) {
  const questions = exam === "first-letters" ? ["q1", "q2", "q3", "q4"] : ["p1"];
  await appendEvents(loaded, [start(exam), ...questions.map((question, index) => answer(question, index < right ? "correct" : "wrong"))], { target: "main" });
  const closed = await closeExams(loaded, [end(exam, extra)]);
  await appendEvents(loaded, closed.inputs, { target: "main" });
  const events = await readEvents(loaded, SUBJECT);
  return { closed, events, milestones: milestoneStatusesOf(await loadSubject(loaded, SUBJECT), events) };
}

describe("an exam's questions", () => {
  it("are the ids of its exam question widgets, however the id is quoted", () => {
    expect(examQuestions(EXAM)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(examQuestions("<p>No questions</p>")).toEqual([]);
  });
});

describe("an exam's pass mark", () => {
  it("is the milestone's pass mark when it sets one", async () => {
    expect(examPassMark(await loadSubject(await home({ passMark: 90 }), SUBJECT), "first-letters")).toBe(90);
  });

  it("is otherwise the subject's resolved pass mark", async () => {
    expect(examPassMark(await loadSubject(await home(), SUBJECT), "first-letters")).toBe(60);
    expect(examPassMark(await loadSubject(await home({ settings: { passMark: 80 } }), SUBJECT), "first-letters")).toBe(80);
    expect(examPassMark(await loadSubject(await home({ passMark: 50, settings: { passMark: 80 } }), SUBJECT), "first-letters")).toBe(50);
  });

  it("is the subject's for an exam no milestone names", async () => {
    expect(examPassMark(await loadSubject(await home({ passMark: 90 }), SUBJECT), "practice")).toBe(60);
  });
});

describe("ending an exam session", () => {
  it("records the score on session.end and marks the milestone done on a pass", async () => {
    const { closed, events, milestones } = await takeExam(await home({ passMark: 75 }), 3);

    expect(closed.exams).toEqual([
      { subject: SUBJECT, exam: "first-letters", sessionId: SESSION, milestone: "first-letters", right: 3, total: 4, score: 75, passMark: 75, passed: true },
    ]);
    const [sessionEnd, marked] = events.slice(-2);
    expect(sessionEnd).toMatchObject({ kind: "session.end", ref: "exam:first-letters", score: 75 });
    expect(marked).toMatchObject({ kind: "milestone.status", ref: "milestone:first-letters", sessionId: SESSION, data: { status: "done" } });
    expect(milestones).toEqual({ "first-letters": "done", next: "upcoming" });
  });

  it("records the score and appends nothing else on a fail", async () => {
    const { closed, events, milestones } = await takeExam(await home({ passMark: 76 }), 3);

    expect(closed.exams[0]).toMatchObject({ score: 75, passMark: 76, passed: false });
    expect(events.at(-1)).toMatchObject({ kind: "session.end", score: 75 });
    expect(events.filter((event) => event.kind === "milestone.status")).toEqual([]);
    expect(milestones["first-letters"]).toBe("current");
  });

  it("counts the page's unanswered questions as missed", async () => {
    const loaded = await home();
    await appendEvents(loaded, [start(), answer("q1", "correct"), answer("q2", "correct")], { target: "main" });

    const closed = await closeExams(loaded, [end()]);

    expect(closed.exams[0]).toMatchObject({ right: 2, total: 4, score: 50, passed: false });
  });

  it("scores over the app's own count, not one the page sent", async () => {
    const { events } = await takeExam(await home(), 0, "first-letters", { score: 100 });

    expect(events.find((event) => event.kind === "session.end")).toMatchObject({ score: 0 });
  });

  it("marks nothing for an exam no milestone names", async () => {
    const { closed, events } = await takeExam(await home(), 1, "practice");

    expect(closed.exams[0]).toMatchObject({ exam: "practice", score: 100, passed: true });
    expect(closed.exams[0]).not.toHaveProperty("milestone");
    expect(events.filter((event) => event.kind === "milestone.status")).toEqual([]);
  });

  it("doesn't mark a milestone that is already done again", async () => {
    const { events } = await takeExam(await home({ milestoneStatus: "done" }), 4);

    expect(events.filter((event) => event.kind === "milestone.status")).toEqual([]);
  });

  it("passes other events through untouched", async () => {
    const loaded = await home();
    const lessonEnd = { ...end(), ref: "drill:review" };

    expect(await closeExams(loaded, [lessonEnd, "not an event"])).toEqual({ inputs: [lessonEnd, "not an event"], exams: [] });
  });
});

describe("a score in the envelope", () => {
  it("is only allowed on session.end, from 0 to 100", async () => {
    const loaded = await home();
    await appendEvents(loaded, [start()], { target: "main" });

    const rejected = async (event: unknown) => {
      const error = await appendEvents(loaded, [event], { target: "main" }).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(InvalidEventError);
      return (error as InvalidEventError).issues.map(({ path, message }) => ({ path, message }));
    };
    expect(await rejected({ ...answer("q1", "correct"), score: 50 })).toEqual([{ path: "score", message: "Only a session.end has a score" }]);
    expect(await rejected(end("first-letters", { score: 101 }))).toEqual([{ path: "score", message: expect.stringContaining("100") }]);
    const [appended] = await appendEvents(loaded, [end("first-letters", { score: 66.66 })], { target: "main" });
    expect((appended!.event as LearningEvent).score).toBe(66.66);
  });
});
