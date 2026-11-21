import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent, InvalidEventError, loadLearningHome } from "@tomewise/core";
import { buildHome, snapshot } from "./helpers.ts";

const SESSION = "01KAJ0000000000000000000S1";

const lessonsAndItems = {
  "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
  "subjects/morse-code/subject.json": { name: "Morse code" },
  "subjects/morse-code/lessons/0001-k-and-m.html": "<h1>K and M</h1>",
  "subjects/morse-code/items/0001-k-and-m.json": [
    { id: "letter-k", type: "timed-audio", answer: "K", audio: "k.wav", unlockedBy: "0001-k-and-m" },
  ],
};

function sessionStart(extra: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    ts: "2026-11-03T18:00:00.000Z",
    subject: "morse-code",
    kind: "session.start",
    ref: "lesson:0001-k-and-m",
    sessionId: SESSION,
    schemaVersion: 1,
    ...extra,
  };
}

function attempt(extra: Record<string, unknown> = {}) {
  return {
    id: "01KAJ0000000000000000000A1",
    ts: "2026-11-03T18:01:00.000Z",
    subject: "morse-code",
    kind: "attempt",
    ref: "item:letter-k",
    sessionId: SESSION,
    duration: 840,
    outcome: "correct",
    grade: 3,
    schemaVersion: 1,
    ...extra,
  };
}

async function lines(root: string, file: string): Promise<unknown[]> {
  const text = await readFile(join(root, file), "utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

describe("appending an event", () => {
  it("creates this machine's file for the event's month and appends one JSON line", async () => {
    const root = await buildHome(lessonsAndItems);
    const home = await loadLearningHome(root);

    await appendEvent(home, sessionStart(), { machine: "laptop" });

    expect(await lines(root, "subjects/morse-code/events/2026-11.laptop.jsonl")).toEqual([
      { ...sessionStart(), data: {} },
    ]);
  });

  it("adds to the end of an existing file", async () => {
    const root = await buildHome(lessonsAndItems);
    const home = await loadLearningHome(root);

    await appendEvent(home, sessionStart(), { machine: "laptop" });
    await appendEvent(home, attempt(), { machine: "laptop" });

    expect(await lines(root, "subjects/morse-code/events/2026-11.laptop.jsonl")).toMatchObject([
      { kind: "session.start" },
      { kind: "attempt", ref: "item:letter-k" },
    ]);
  });

  it("gives an event without an id or timestamp a new ULID and the current time", async () => {
    const root = await buildHome(lessonsAndItems);
    const home = await loadLearningHome(root);
    await appendEvent(home, sessionStart(), { machine: "laptop" });

    const { event } = await appendEvent(home, { ...attempt(), id: undefined, ts: undefined }, {
      machine: "laptop",
      now: new Date(1469918176385),
    });

    expect(event.ts).toBe("2016-07-30T22:36:16.385Z");
    expect(event.id).toMatch(/^01ARYZ6S41[0-9A-HJKMNP-TV-Z]{16}$/);
  });

  it("starts a session whose session id is its own id when none is given", async () => {
    const root = await buildHome(lessonsAndItems);
    const home = await loadLearningHome(root);

    const { event } = await appendEvent(home, { ...sessionStart(), id: undefined, sessionId: undefined }, {
      machine: "laptop",
    });

    expect(event.sessionId).toBe(event.id);
  });
});

describe("rejecting an event", () => {
  async function rejected(input: unknown, files: Record<string, unknown> = lessonsAndItems) {
    const root = await buildHome(files);
    const home = await loadLearningHome(root);
    await appendEvent(home, sessionStart(), { machine: "laptop" });
    const before = await snapshot(root);

    const error = await appendEvent(home, input, { machine: "laptop" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidEventError);
    expect(await snapshot(root)).toEqual(before);
    return (error as InvalidEventError).issues;
  }

  it("rejects a bad envelope", async () => {
    expect(await rejected(attempt({ ts: "3 November", duration: 1.5 }))).toEqual([
      { file: "event", path: "ts", message: expect.stringContaining("UTC ISO 8601") },
      { file: "event", path: "duration", message: "Use whole milliseconds" },
    ]);
  });

  it("rejects an unknown kind", async () => {
    expect(await rejected(attempt({ kind: "guess" }))).toEqual([
      { file: "event", path: "kind", message: expect.stringContaining("Unknown kind; use one of attempt, session.start") },
    ]);
  });

  it("rejects a ref to something the subject doesn't have", async () => {
    expect(await rejected(attempt({ ref: "item:letter-z" }))).toEqual([
      { file: "event", path: "ref", message: 'No item "letter-z" in subjects/morse-code/items' },
    ]);
    expect(await rejected(sessionStart({ id: "01KAJ0000000000000000000S2", sessionId: "01KAJ0000000000000000000S2", ref: "drill:sprint" }))).toEqual([
      { file: "event", path: "ref", message: 'No drill "sprint" in subjects/morse-code/drills' },
    ]);
    expect(await rejected({ ...attempt(), kind: "explanation.graded", ref: "event:01KAJ00000000000000000000Z", outcome: undefined, grade: undefined })).toEqual([
      { file: "event", path: "ref", message: 'No event "01KAJ00000000000000000000Z" in subjects/morse-code/events' },
    ]);
  });

  it("rejects a ref that isn't typed as kind:id", async () => {
    expect(await rejected(attempt({ ref: "letter-k" }))).toEqual([
      { file: "event", path: "ref", message: expect.stringContaining('Use kind:id, such as "item:letter-k"') },
    ]);
  });

  it("rejects an attempt that refers to anything but an item", async () => {
    expect(await rejected(attempt({ ref: "lesson:0001-k-and-m" }))).toEqual([
      { file: "event", path: "ref", message: "An attempt refers to an item" },
    ]);
  });

  it("rejects an attempt without an outcome and grade, and a grade on anything else", async () => {
    expect(await rejected(attempt({ outcome: undefined, grade: undefined }))).toEqual([
      { file: "event", path: "outcome", message: "An attempt needs an outcome" },
      { file: "event", path: "grade", message: "An attempt needs a grade from 1 to 4" },
    ]);
    expect(await rejected({ ...attempt(), kind: "lesson.completed", ref: "lesson:0001-k-and-m", outcome: undefined })).toEqual([
      { file: "event", path: "grade", message: "Only attempts have a grade" },
    ]);
  });

  it("rejects a session id that names no session.start", async () => {
    expect(await rejected(attempt({ sessionId: "01KAJ00000000000000000000Z" }))).toEqual([
      { file: "event", path: "sessionId", message: 'No session.start with id "01KAJ00000000000000000000Z" in subjects/morse-code/events' },
    ]);
  });

  it("rejects an event for a subject that doesn't exist", async () => {
    expect(await rejected(attempt({ subject: "yoga" }))).toEqual([
      { file: "event", path: "subject", message: 'No subject "yoga"; subjects: morse-code' },
    ]);
  });

  it("rejects an event whose id is already used", async () => {
    expect(await rejected(sessionStart())).toEqual([
      { file: "event", path: "id", message: `Event id "${SESSION}" is already used` },
    ]);
  });
});


describe("event ids", () => {
  it("rejects a ULID whose timestamp overflows 48 bits", async () => {
    const home = await loadLearningHome(await buildHome(lessonsAndItems));

    const error = await appendEvent(home, sessionStart({ id: "81KAJ0000000000000000000S1", sessionId: undefined }), {
      machine: "laptop",
    }).catch((e: unknown) => e);

    expect((error as InvalidEventError).issues).toContainEqual({ file: "event", path: "id", message: expect.stringContaining("ULID") });
  });
});
