import { describe, expect, it } from "vitest";
import { appendEvent, InvalidEventError, loadLearningHome, validateLearningHome } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SESSION = "01KAJ0000000000000000000S1";

const v1 = {
  version: 1,
  kinds: {
    attempt: {
      type: "object",
      properties: {
        answer: { type: "string" },
        heard: { type: "string" },
        responseTime: { type: "integer", unit: "ms" },
      },
      required: ["answer", "heard", "responseTime"],
    },
  },
};

const v2 = {
  version: 2,
  kinds: {
    attempt: {
      type: "object",
      properties: {
        ...v1.kinds.attempt.properties,
        wpm: { type: "number", unit: "wpm" },
        mode: { enum: ["copy", "send"] },
        timings: { type: "array", items: { type: "integer", unit: "ms" } },
      },
      required: ["answer", "heard", "responseTime", "wpm"],
    },
  },
};

function files(payloadSchemas: unknown[]) {
  return {
    "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
    "subjects/morse-code/subject.json": { name: "Morse code", payloadSchemas },
    "subjects/morse-code/lessons/0001-k-and-m.html": "<h1>K and M</h1>",
    "subjects/morse-code/items/0001-k-and-m.json": [
      { id: "letter-k", type: "timed-audio", answer: "K", audio: "k.wav", unlockedBy: "0001-k-and-m" },
    ],
  };
}

const start = {
  id: SESSION,
  ts: "2026-11-03T18:00:00.000Z",
  subject: "morse-code",
  kind: "session.start",
  ref: "lesson:0001-k-and-m",
  sessionId: SESSION,
  schemaVersion: 1,
};

function attempt(schemaVersion: number, data: Record<string, unknown>) {
  return {
    ts: "2026-11-03T18:01:00.000Z",
    subject: "morse-code",
    kind: "attempt",
    ref: "item:letter-k",
    sessionId: SESSION,
    outcome: "correct",
    grade: 3,
    schemaVersion,
    data,
  };
}

async function homeWith(payloadSchemas: unknown[]) {
  const home = await loadLearningHome(await buildHome(files(payloadSchemas)));
  await appendEvent(home, start, { machine: "laptop" });
  return home;
}

async function issuesLogging(payloadSchemas: unknown[], event: unknown) {
  const home = await homeWith(payloadSchemas);
  const error = await appendEvent(home, event, { machine: "laptop" }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(InvalidEventError);
  return (error as InvalidEventError).issues;
}

describe("payload schemas", () => {
  it("accepts a payload that matches the version the event names, old or new", async () => {
    const home = await homeWith([v1, v2]);

    const old = await appendEvent(home, attempt(1, { answer: "K", heard: "K", responseTime: 640 }), {
      machine: "laptop",
    });
    const current = await appendEvent(
      home,
      attempt(2, { answer: "K", heard: "K", responseTime: 640, wpm: 18.5, mode: "copy", timings: [60, 180, 60] }),
      { machine: "laptop" },
    );

    expect(old.event.data).toEqual({ answer: "K", heard: "K", responseTime: 640 });
    expect(current.event.data).toMatchObject({ wpm: 18.5, mode: "copy" });
  });

  it("rejects a payload that fails its version, naming each field", async () => {
    expect(
      await issuesLogging([v1, v2], attempt(2, { answer: "K", responseTime: 6.5, wpm: "fast", mode: "listen", extra: 1 })),
    ).toEqual([
      { file: "event", path: "data.heard", message: expect.any(String) },
      { file: "event", path: "data.responseTime", message: expect.any(String) },
      { file: "event", path: "data.wpm", message: expect.any(String) },
      { file: "event", path: "data.mode", message: expect.any(String) },
      { file: "event", path: "data.extra", message: "Unknown field" },
    ]);
  });

  it("checks an old event against its own version, not the newest", async () => {
    expect(await issuesLogging([v1, v2], attempt(1, { answer: "K", heard: "K", responseTime: 640, wpm: 18 }))).toEqual([
      { file: "event", path: "data.wpm", message: "Unknown field" },
    ]);
  });

  it("rejects a schemaVersion the subject doesn't have", async () => {
    expect(await issuesLogging([v1], attempt(2, { answer: "K", heard: "K", responseTime: 640 }))).toEqual([
      { file: "event", path: "schemaVersion", message: "Subject morse-code has payload schema versions 1" },
    ]);
  });

  it("allows no payload on a kind the version doesn't describe", async () => {
    expect(
      await issuesLogging([v1], { ...attempt(1, { note: "hi" }), kind: "lesson.completed", ref: "lesson:0001-k-and-m", grade: undefined }),
    ).toEqual([{ file: "event", path: "data.note", message: "Unknown field" }]);
  });

  it("gives a subject without payload schemas a version 1 with no payload", async () => {
    const home = await homeWith([]);

    const { event } = await appendEvent(home, { ...start, id: undefined, sessionId: undefined, schemaVersion: 1 }, {
      machine: "laptop",
    });

    expect(event.data).toEqual({});
  });
});

describe("validating payload schema versions", () => {
  it("accepts a new version that adds fields", async () => {
    expect(await validateLearningHome(await buildHome(files([v1, v2])))).toEqual([]);
  });

  it("reports a version that removes a field", async () => {
    const { answer: _, ...rest } = v2.kinds.attempt.properties;
    const dropped = { version: 2, kinds: { attempt: { type: "object", properties: rest, required: [] } } };

    expect(await validateLearningHome(await buildHome(files([v1, dropped])))).toEqual([
      {
        file: "subjects/morse-code/subject.json",
        path: "payloadSchemas[1].kinds.attempt.properties",
        message: 'Version 2 drops field "answer" from version 1; versions are only ever extended',
      },
    ]);
  });

  it("reports a version that retypes a field or changes its unit", async () => {
    const retyped = {
      version: 2,
      kinds: {
        attempt: {
          type: "object",
          properties: { answer: { type: "string" }, heard: { type: "integer" }, responseTime: { type: "integer", unit: "s" } },
          required: [],
        },
      },
    };

    expect(await validateLearningHome(await buildHome(files([v1, retyped])))).toEqual([
      {
        file: "subjects/morse-code/subject.json",
        path: "payloadSchemas[1].kinds.attempt.properties.heard",
        message: 'Version 2 changes field "heard" from version 1; versions are only ever extended',
      },
      {
        file: "subjects/morse-code/subject.json",
        path: "payloadSchemas[1].kinds.attempt.properties.responseTime",
        message: 'Version 2 changes field "responseTime" from version 1; versions are only ever extended',
      },
    ]);
  });

  it("reports a version that drops a kind", async () => {
    expect(await validateLearningHome(await buildHome(files([v1, { version: 2, kinds: {} }])))).toEqual([
      {
        file: "subjects/morse-code/subject.json",
        path: "payloadSchemas[1].kinds",
        message: 'Version 2 drops kind "attempt" from version 1; versions are only ever extended',
      },
    ]);
  });

  it("reports a field outside the restricted schema", async () => {
    const bad = {
      version: 1,
      kinds: { attempt: { type: "object", properties: { nested: { type: "object" } } } },
    };

    expect(await validateLearningHome(await buildHome(files([bad])))).toEqual([
      {
        file: "subjects/morse-code/subject.json",
        path: "payloadSchemas[0].kinds.attempt.properties.nested",
        message: expect.stringContaining("number, integer, string, boolean, enum"),
      },
    ]);
  });

  it("reports versions out of order and required fields missing from properties", async () => {
    const bad = { version: 3, kinds: { attempt: { ...v1.kinds.attempt, required: ["answer", "missing"] } } };

    expect(await validateLearningHome(await buildHome(files([v1, bad])))).toEqual([
      {
        file: "subjects/morse-code/subject.json",
        path: "payloadSchemas[1].version",
        message: "Expected version 2; number versions 1, 2, 3 in order",
      },
      {
        file: "subjects/morse-code/subject.json",
        path: "payloadSchemas[1].kinds.attempt.required[1]",
        message: 'Required field "missing" is not in properties',
      },
    ]);
  });
});
