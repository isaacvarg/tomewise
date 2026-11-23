import { describe, expect, it } from "vitest";
import { agentPrompts, explanations, loadLearningHome, loadSubject, readEvents } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SUBJECT = "morse-code";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `01KAJ${String(counter).padStart(21, "0")}`;
}

function completed(lesson: string) {
  return { id: nextId(), ts: "2026-11-02T09:00:00.000Z", subject: SUBJECT, kind: "lesson.completed", ref: `lesson:${lesson}`, schemaVersion: 1 };
}

function marked(status: string, ts = "2026-11-03T09:00:00.000Z") {
  return { id: nextId(), ts, subject: SUBJECT, kind: "milestone.status", ref: "milestone:first-letters", schemaVersion: 1, data: { status } };
}

function saved(ref: string, text: string, ts = "2026-11-03T18:00:00.000Z") {
  return { id: nextId(), ts, subject: SUBJECT, kind: "explanation.saved", ref, schemaVersion: 1, data: { text } };
}

function graded(explanation: { id: string }, feedback: string, ts = "2026-11-04T08:00:00.000Z") {
  return { id: nextId(), ts, subject: SUBJECT, kind: "explanation.graded", ref: `event:${explanation.id}`, schemaVersion: 1, data: { feedback } };
}

interface Milestone {
  status?: string;
  lessons?: string[];
  exam?: string;
}

async function state(events: object[], milestone: Milestone = {}, files: Record<string, string> = {}) {
  const root = await buildHome({
    "tomewise.json": { formatVersion: 1, timezone: "UTC" },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code" },
    [`subjects/${SUBJECT}/lessons/0001-k-and-m.html`]: "<h1>K and M</h1>",
    [`subjects/${SUBJECT}/lessons/0002-r.html`]: "<h1>R</h1>",
    [`subjects/${SUBJECT}/lessons/0003-s.html`]: "<h1>S</h1>",
    [`subjects/${SUBJECT}/curriculum.json`]: {
      units: [
        {
          title: "Koch letters",
          milestones: [
            {
              id: "first-letters",
              title: "Copy K, M and R",
              status: milestone.status ?? "current",
              lessons: milestone.lessons ?? ["0001-k-and-m", "0002-r"],
              ...(milestone.exam !== undefined && { exam: milestone.exam }),
            },
            { id: "s", title: "Copy S", status: "upcoming", lessons: ["0003-s"] },
          ],
        },
      ],
    },
    [`subjects/${SUBJECT}/events/2026-11.jsonl`]: events.map((event) => `${JSON.stringify(event)}\n`).join(""),
    ...Object.fromEntries(Object.entries(files).map(([path, content]) => [`subjects/${SUBJECT}/${path}`, content])),
  });
  const home = await loadLearningHome(root);
  return { subject: await loadSubject(home, SUBJECT), events: await readEvents(home, SUBJECT) };
}

async function promptsFor(...args: Parameters<typeof state>) {
  const { subject, events } = await state(...args);
  return agentPrompts(subject, events);
}

const FIRST = { id: "first-letters", title: "Copy K, M and R" };

describe("ask-your-agent prompts", () => {
  it("has none while a milestone still has lessons to do", async () => {
    expect(await promptsFor([completed("0001-k-and-m")])).toEqual([]);
    expect(await promptsFor([completed("0001-k-and-m")], { exam: "first-letters" }, { "exams/first-letters.html": "<h1>Exam</h1>" })).toEqual([]);
  });

  it("asks to mark a milestone done once its lessons are, when it has no exam", async () => {
    expect(await promptsFor([completed("0001-k-and-m"), completed("0002-r")])).toEqual([
      { kind: "milestone-done", milestone: FIRST, say: "Mark the “Copy K, M and R” milestone done." },
    ]);
  });

  it("asks for the exam once a milestone's lessons are done and its exam isn't written", async () => {
    expect(await promptsFor([completed("0001-k-and-m"), completed("0002-r")], { exam: "first-letters" })).toEqual([
      { kind: "exam-unwritten", milestone: FIRST, exam: "first-letters", say: "Prepare the exam for “Copy K, M and R”." },
    ]);
  });

  it("points to the exam once it's written", async () => {
    const events = [completed("0001-k-and-m"), completed("0002-r")];
    expect(await promptsFor(events, { exam: "first-letters" }, { "exams/first-letters.html": "<h1>Exam</h1>" })).toEqual([
      { kind: "exam-ready", milestone: FIRST, exam: "first-letters", say: "Go over my exam results for “Copy K, M and R”." },
    ]);
  });

  it("drops a milestone's prompt once the milestone is done or skipped", async () => {
    const events = [completed("0001-k-and-m"), completed("0002-r")];
    expect(await promptsFor(events, { status: "done", exam: "first-letters" }, { "exams/first-letters.html": "" })).toEqual([]);
    expect(await promptsFor(events, { status: "skipped" })).toEqual([]);
  });

  it("goes by the milestone's latest status event over curriculum.json", async () => {
    const events = [completed("0001-k-and-m"), completed("0002-r")];
    expect(await promptsFor([...events, marked("done")])).toEqual([]);
    expect(await promptsFor([...events, marked("skipped")])).toEqual([]);
    expect(await promptsFor([...events, marked("done"), marked("current", "2026-11-04T09:00:00.000Z")])).toHaveLength(1);
    expect(await promptsFor([...events, marked("current")], { status: "done" })).toEqual([
      { kind: "milestone-done", milestone: FIRST, say: "Mark the “Copy K, M and R” milestone done." },
    ]);
  });

  it("has none for a milestone with no lessons", async () => {
    expect(await promptsFor([], { lessons: [] })).toEqual([]);
  });

  it("asks to grade explanations saved with no grade, until they're graded", async () => {
    const lesson = saved("lesson:0002-r", "R is dit-dah-dit");
    const again = saved("lesson:0002-r", "R is short-long-short", "2026-11-03T18:05:00.000Z");
    const item = saved("item:letter-k", "K is dah-dit-dah", "2026-11-03T18:10:00.000Z");
    expect(await promptsFor([lesson, again, item])).toEqual([
      { kind: "ungraded-explanations", count: 3, refs: ["lesson:0002-r", "item:letter-k"], say: "Grade my Morse code explanations." },
    ]);
    expect(await promptsFor([lesson, again, item, graded(lesson, "Yes"), graded(item, "Yes")])).toEqual([
      { kind: "ungraded-explanations", count: 1, refs: ["lesson:0002-r"], say: "Grade my Morse code explanation." },
    ]);
    expect(await promptsFor([lesson, again, item, graded(lesson, "Yes"), graded(again, "Yes"), graded(item, "Yes")])).toEqual([]);
  });

  it("lists milestone prompts in curriculum order, then explanations", async () => {
    const events = [completed("0001-k-and-m"), completed("0002-r"), completed("0003-s"), saved("lesson:0003-s", "S is dit-dit-dit")];
    expect((await promptsFor(events)).map((prompt) => prompt.kind)).toEqual(["milestone-done", "milestone-done", "ungraded-explanations"]);
  });
});

describe("explanations", () => {
  it("pairs each explanation with the agent's latest feedback, newest explanation first", async () => {
    const first = saved("lesson:0002-r", "R is dit-dah-dit");
    const second = saved("item:letter-k", "K is dah-dit-dah", "2026-11-03T19:00:00.000Z");
    const { events } = await state([first, second, graded(first, "Close."), graded(first, "Right: short, long, short.", "2026-11-05T08:00:00.000Z")]);

    expect(explanations(events)).toEqual([
      { id: second.id, ts: second.ts, ref: "item:letter-k", text: "K is dah-dit-dah" },
      {
        id: first.id,
        ts: first.ts,
        ref: "lesson:0002-r",
        text: "R is dit-dah-dit",
        grade: { id: expect.any(String), ts: "2026-11-05T08:00:00.000Z", feedback: "Right: short, long, short." },
      },
    ]);
  });
});
