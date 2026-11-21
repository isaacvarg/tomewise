import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dueItems, loadLearningHome, loadSubject, readActivity, readEvents } from "@tomewise/core";
import { startTestApp } from "./harness.ts";

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

describe("GET /api/subjects", () => {
  it("lists every subject in the learning home", async () => {
    const app = await startTestApp();
    const home = await loadLearningHome(app.root);

    const response = await app.get("/api/subjects");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ subjects: json([await loadSubject(home, "morse-code")]) });
  });
});

describe("GET /api/subjects/:subject", () => {
  it("returns the subject as core loads it", async () => {
    const app = await startTestApp();
    const home = await loadLearningHome(app.root);

    const response = await app.get("/api/subjects/morse-code");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(json(await loadSubject(home, "morse-code")));
  });

  it("gives 404 naming the subjects there are for an unknown subject", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/subjects/klingon");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/No subject "klingon".*Subjects: morse-code/);
  });
});

describe("GET /api/subjects/:subject/events", () => {
  it("returns the subject's events in the range from every file", async () => {
    const app = await startTestApp();
    const home = await loadLearningHome(app.root);
    const range = { from: "2026-11-02", to: "2026-11-09" };

    const response = await app.get("/api/subjects/morse-code/events?from=2026-11-02&to=2026-11-09");

    expect(response.status).toBe(200);
    const expected = await readEvents(home, "morse-code", range);
    expect(expected.map((event) => event.ts.slice(0, 10))).toContain("2026-11-08");
    expect(response.body).toEqual({ events: expected });
  });

  it("returns all of history without a range", async () => {
    const app = await startTestApp();
    const home = await loadLearningHome(app.root);

    const response = await app.get("/api/subjects/morse-code/events");

    expect(response.body).toEqual({ events: await readEvents(home, "morse-code") });
    expect(response.body.events).toHaveLength(33);
  });

  it("gives 400 for a malformed date", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/subjects/morse-code/events?from=yesterday");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Not a date: yesterday/);
  });

  it("gives 404 for an unknown subject", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/subjects/klingon/events");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/subjects/:subject/due", () => {
  it("returns what is due by the end of the date", async () => {
    const app = await startTestApp();
    const home = await loadLearningHome(app.root);

    const response = await app.get("/api/subjects/morse-code/due?date=2026-11-21");

    expect(response.status).toBe(200);
    const expected = await dueItems(home, "morse-code", "2026-11-21");
    expect(expected.length).toBeGreaterThan(0);
    expect(response.body).toEqual({ due: json(expected) });
  });

  it("uses today without a date", async () => {
    const app = await startTestApp();
    const home = await loadLearningHome(app.root);

    const response = await app.get("/api/subjects/morse-code/due");

    expect(response.body).toEqual({ due: json(await dueItems(home, "morse-code", new Date())) });
  });

  it("gives 400 for a malformed date", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/subjects/morse-code/due?date=2026-11-21T10:00");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Not a date: 2026-11-21T10:00; use YYYY-MM-DD/);
  });

  it("gives 404 for an unknown subject", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/subjects/klingon/due?date=2026-11-21");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/activity", () => {
  const shortSessionsCount = (root: string) =>
    writeFile(
      join(root, "tomewise.json"),
      JSON.stringify({ formatVersion: 1, timezone: "Europe/London", weekStart: "monday", minimumSessionSeconds: 1 }),
    );

  it("returns activity days, streak and goals for the range", async () => {
    const app = await startTestApp(shortSessionsCount);
    const home = await loadLearningHome(app.root);

    const response = await app.get("/api/activity?from=2026-11-01&to=2026-11-21");

    expect(response.status).toBe(200);
    const expected = await readActivity(home, { from: "2026-11-01", to: "2026-11-21" });
    expect(expected.days.map((day) => day.date)).toEqual(["2026-11-02", "2026-11-05", "2026-11-08"]);
    expect(response.body).toEqual(json(expected));
  });

  it("reads all of history as of today without a range", async () => {
    const app = await startTestApp(shortSessionsCount);
    const home = await loadLearningHome(app.root);

    const response = await app.get("/api/activity?from=&to=");

    expect(response.body).toEqual(json(await readActivity(home)));
  });

  it("gives 400 for a malformed date", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/activity?to=2026-13-01");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Not a date: 2026-13-01; use YYYY-MM-DD/);
  });
});

describe("an event posted to the app", () => {
  it("shows up in the events, due and activity endpoints", async () => {
    const app = await startTestApp();
    const session = "01KAM0000000000000000000S1";
    const base = { subject: "morse-code", ref: "lesson:0003-s", schemaVersion: 2, data: {} };
    const posted = [
      { ...base, id: session, ts: "2026-11-22T09:00:00.000Z", kind: "session.start", sessionId: session },
      { ...base, id: "01KAM0000000000000000000C1", ts: "2026-11-22T09:01:30.000Z", kind: "lesson.completed" },
      {
        ...base,
        id: "01KAM0000000000000000000E1",
        ts: "2026-11-22T09:02:00.000Z",
        kind: "session.end",
        sessionId: session,
        duration: 120_000,
      },
    ];
    const dueBefore = await app.get("/api/subjects/morse-code/due?date=2026-11-22");
    expect(dueBefore.body.due.map((due: any) => due.item.id)).not.toContain("letter-s");

    expect((await app.post(posted)).status).toBe(201);

    const events = await app.get("/api/subjects/morse-code/events?from=2026-11-22");
    expect(events.body).toEqual({ events: posted });
    const due = await app.get("/api/subjects/morse-code/due?date=2026-11-22");
    expect(due.body.due).toContainEqual({ item: expect.objectContaining({ id: "letter-s" }), due: "2026-11-22T09:01:30.000Z" });
    const activity = await app.get("/api/activity?from=2026-11-22&to=2026-11-22");
    expect(activity.body.days).toEqual([{ date: "2026-11-22", subjects: ["morse-code"] }]);
  });
});
