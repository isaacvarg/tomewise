import { describe, expect, it } from "vitest";
import { validateLearningHome } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SESSION = "01KAJ0000000000000000000S1";
const FILE = "subjects/morse-code/events/2026-11.jsonl";

const base = {
  "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
  "subjects/morse-code/subject.json": {
    name: "Morse code",
    payloadSchemas: [
      { version: 1, kinds: { attempt: { properties: { heard: { type: "string" } }, required: ["heard"] } } },
    ],
  },
  "subjects/morse-code/lessons/0001-k-and-m.html": "<h1>K and M</h1>",
  "subjects/morse-code/items/0001-k-and-m.json": [{ id: "letter-k", type: "flashcard", front: "-.-", back: "K" }],
};

const start = {
  id: SESSION,
  ts: "2026-11-03T18:00:00.000Z",
  subject: "morse-code",
  kind: "session.start",
  ref: "lesson:0001-k-and-m",
  sessionId: SESSION,
  schemaVersion: 1,
};

function attempt(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    ts: "2026-11-03T18:01:00.000Z",
    subject: "morse-code",
    kind: "attempt",
    ref: "item:letter-k",
    sessionId: SESSION,
    outcome: "correct",
    grade: 3,
    schemaVersion: 1,
    data: { heard: "K" },
    ...extra,
  };
}

function jsonl(...lines: unknown[]): string {
  return lines.map((line) => `${typeof line === "string" ? line : JSON.stringify(line)}\n`).join("");
}

describe("validating events", () => {
  it("accepts good event lines across main and per-machine files", async () => {
    const home = await buildHome({
      ...base,
      [FILE]: jsonl(start),
      "subjects/morse-code/events/2026-11.laptop.jsonl": jsonl(attempt("01KAJ0000000000000000000A1")),
    });

    expect(await validateLearningHome(home)).toEqual([]);
  });

  it("reports each bad line with its file and line number", async () => {
    const home = await buildHome({
      ...base,
      [FILE]: jsonl(
        start,
        "{ not json",
        attempt("01KAJ0000000000000000000A2", { grade: 7 }),
        attempt("01KAJ0000000000000000000A3", { ref: "item:letter-z" }),
        attempt("01KAJ0000000000000000000A4", { data: { heard: 1 } }),
        attempt("01KAJ0000000000000000000A5", { subject: "yoga" }),
        attempt("01KAJ0000000000000000000A6", { ts: "2026-10-31T23:00:00.000Z" }),
        attempt("01KAJ0000000000000000000A6"),
      ),
    });

    expect(await validateLearningHome(home)).toEqual([
      { file: FILE, line: 2, path: "", message: expect.stringMatching(/^Invalid JSON/) },
      { file: FILE, line: 3, path: "grade", message: expect.any(String) },
      { file: FILE, line: 4, path: "ref", message: 'No item "letter-z" in subjects/morse-code/items' },
      { file: FILE, line: 5, path: "data.heard", message: expect.any(String) },
      { file: FILE, line: 6, path: "subject", message: 'This event is filed under subject "morse-code"' },
      { file: FILE, line: 7, path: "ts", message: "This event is from 2026-10 but is in a 2026-11 file" },
      { file: FILE, line: 8, path: "id", message: `Duplicate event id "01KAJ0000000000000000000A6"; first used in ${FILE}:7` },
    ]);
  });

  it("checks an explanation's text, whatever the subject's payload schema", async () => {
    const explanation = (id: string, data: Record<string, unknown>) => ({
      id,
      ts: "2026-11-03T18:02:00.000Z",
      subject: "morse-code",
      kind: "explanation.saved",
      ref: "lesson:0001-k-and-m",
      schemaVersion: 1,
      data,
    });
    const home = await buildHome({
      ...base,
      [FILE]: jsonl(
        explanation("01KAJ0000000000000000000E1", { text: "K is dah-dit-dah" }),
        explanation("01KAJ0000000000000000000E2", {}),
        explanation("01KAJ0000000000000000000E3", { text: "  " }),
        explanation("01KAJ0000000000000000000E4", { text: "ok", mood: "fine" }),
      ),
    });

    expect(await validateLearningHome(home)).toEqual([
      { file: FILE, line: 2, path: "data.text", message: expect.any(String) },
      { file: FILE, line: 3, path: "data.text", message: expect.any(String) },
      { file: FILE, line: 4, path: "data.mood", message: expect.any(String) },
    ]);
  });

  it("checks a grade's feedback, whatever the subject's payload schema", async () => {
    const saved = {
      id: "01KAJ0000000000000000000E1",
      ts: "2026-11-03T18:02:00.000Z",
      subject: "morse-code",
      kind: "explanation.saved",
      ref: "lesson:0001-k-and-m",
      schemaVersion: 1,
      data: { text: "K is dah-dit-dah" },
    };
    const graded = (id: string, data: Record<string, unknown>) => ({ ...saved, id, kind: "explanation.graded", ref: `event:${saved.id}`, data });
    const home = await buildHome({
      ...base,
      [FILE]: jsonl(
        saved,
        graded("01KAJ0000000000000000000G1", { feedback: "Right. Now say why the gap matters." }),
        graded("01KAJ0000000000000000000G2", {}),
        graded("01KAJ0000000000000000000G3", { feedback: " " }),
      ),
    });

    expect(await validateLearningHome(home)).toEqual([
      { file: FILE, line: 3, path: "data.feedback", message: "A grade needs the agent's feedback" },
      { file: FILE, line: 4, path: "data.feedback", message: "A grade needs the agent's feedback" },
    ]);
  });

  it("reports a file in events that isn't an event file", async () => {
    const home = await buildHome({ ...base, "subjects/morse-code/events/notes.txt": "hello" });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/morse-code/events/notes.txt",
        path: "",
        message: "Not an event file; name it YYYY-MM.jsonl or YYYY-MM.<machine>.jsonl",
      },
    ]);
  });
});
