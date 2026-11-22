import { describe, expect, it } from "vitest";
import { startTestApp } from "./harness.ts";

const SESSION = "01KAJ0000000000000000000S1";

const start = {
  id: SESSION,
  ts: "2026-11-21T18:00:00.000Z",
  subject: "morse-code",
  kind: "session.start",
  ref: "lesson:0001-k-and-m",
  sessionId: SESSION,
  schemaVersion: 2,
  data: {},
};

describe("POST /api/events", () => {
  it("appends a valid event to the main monthly file and returns it", async () => {
    const app = await startTestApp();
    const before = await app.lines("2026-11.jsonl");

    const response = await app.post(start);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ events: [start] });
    expect(await app.lines("2026-11.jsonl")).toEqual([...before, start]);
  });
});

describe("filling in what a widget leaves out", () => {
  it("gives the event an id and the time it arrived", async () => {
    const app = await startTestApp();
    const { id: _, ts: __, sessionId: ___, ...bare } = start;
    const sent = Date.now();

    const response = await app.post(bare);

    expect(response.status).toBe(201);
    const [event] = response.body.events;
    expect(event.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(event.sessionId).toBe(event.id);
    expect(Date.parse(event.ts)).toBeGreaterThanOrEqual(sent - 1);
    expect(Date.parse(event.ts)).toBeLessThanOrEqual(Date.now());
    const month = event.ts.slice(0, 7);
    expect((await app.lines(`${month}.jsonl`)).at(-1)).toEqual(event);
  });
});

function attempt(n: number, extra: Record<string, unknown> = {}) {
  return {
    ts: new Date(Date.UTC(2026, 10, 21, 18, 1, 0, n)).toISOString(),
    subject: "morse-code",
    kind: "attempt",
    ref: "item:letter-k",
    sessionId: SESSION,
    duration: 600,
    outcome: "correct",
    grade: 3,
    schemaVersion: 2,
    data: { heard: "K", answer: "K", responseTime: 600, wpm: 18 },
    ...extra,
  };
}

describe("posting a batch", () => {
  it("appends a session.start and the attempts that refer to it, in order", async () => {
    const app = await startTestApp();
    const before = await app.lines("2026-11.jsonl");

    const response = await app.post([start, attempt(1), attempt(2)]);

    expect(response.status).toBe(201);
    expect(response.body.events.map((event: any) => event.kind)).toEqual(["session.start", "attempt", "attempt"]);
    expect(await app.lines("2026-11.jsonl")).toEqual([...before, ...response.body.events]);
  });

  it("rejects the whole batch when one event is bad, naming each failing event, and writes nothing", async () => {
    const app = await startTestApp();
    const before = await app.eventFiles();
    const beforeLines = await app.lines("2026-11.jsonl");

    const response = await app.post([start, attempt(1, { ref: "item:letter-q" }), attempt(2), attempt(3, { grade: 9 })]);

    expect(response.status).toBe(400);
    expect(response.body.events).toBeUndefined();
    const failing = response.body.issues.map((issue: any) => `${issue.file} ${issue.path}`);
    expect(failing).toEqual(["events[1] ref", "events[3] grade"]);
    expect(await app.eventFiles()).toEqual(before);
    expect(await app.lines("2026-11.jsonl")).toEqual(beforeLines);
  });

  it("rejects an attempt whose session.start is neither in history nor earlier in the batch", async () => {
    const app = await startTestApp();

    const response = await app.post([attempt(1), start]);

    expect(response.status).toBe(400);
    expect(response.body.issues.map((issue: any) => `${issue.file} ${issue.path}`)).toEqual(["events[0] sessionId"]);
  });

  it("rejects two events in one batch that share an id", async () => {
    const app = await startTestApp();

    const response = await app.post([start, start]);

    expect(response.status).toBe(400);
    expect(response.body.issues.map((issue: any) => `${issue.file} ${issue.path}`)).toEqual(["events[1] id"]);
  });
});

describe("rejecting what isn't events", () => {
  it("rejects a body that isn't JSON", async () => {
    const app = await startTestApp();

    const response = await app.post("{ nope");

    expect(response.status).toBe(400);
    expect(response.body.issues[0].message).toMatch(/^Invalid JSON/);
  });

  it("rejects an empty batch", async () => {
    const app = await startTestApp();

    expect((await app.post([])).status).toBe(400);
  });
});

describe("posting at the same time", () => {
  it("writes every event of every post as a whole line", async () => {
    const app = await startTestApp();
    const before = await app.lines("2026-11.jsonl");
    const sessions = Array.from({ length: 20 }, (_, n) => `01KAJ00000000000000000S${String(n).padStart(3, "0")}`);
    const padding = "x".repeat(4000);

    const responses = await Promise.all(
      sessions.map((sessionId) =>
        app.post([
          { ...start, id: sessionId, sessionId, data: {} },
          ...[1, 2, 3].map((n) => attempt(n, { sessionId, data: { heard: padding, answer: "K", responseTime: 600, wpm: 18 } })),
        ]),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(sessions.map(() => 201));
    const after = await app.lines("2026-11.jsonl");
    expect(after.slice(0, before.length)).toEqual(before);
    const added = after.slice(before.length);
    expect(added).toHaveLength(80);
    for (const sessionId of sessions) {
      expect(added.filter((event) => event.sessionId === sessionId).map((event) => event.kind)).toEqual([
        "session.start",
        "attempt",
        "attempt",
        "attempt",
      ]);
    }
  });
});
