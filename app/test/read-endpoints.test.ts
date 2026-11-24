import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dueItems, loadLearningHome, loadSubject, nextDue, readActivity, readEvents } from "@tomewise/core";
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
    expect(response.body.events).toHaveLength(35);
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

describe("GET /api/subjects/:subject/unlocked", () => {
  it("returns each unlocked item with when it's next due, dated in the home's timezone", async () => {
    const app = await startTestApp();
    const home = await loadLearningHome(app.root);

    const response = await app.get("/api/subjects/morse-code/unlocked?date=2026-11-21");

    expect(response.status).toBe(200);
    expect(response.body.today).toBe("2026-11-21");
    expect(response.body.items.map((entry: any) => entry.item.id)).toEqual(["letter-k", "letter-m", "letter-r"]);
    expect(response.body.items.every((entry: any) => entry.dueOn === entry.due.slice(0, 10))).toBe(true);
    expect(response.body).toEqual({ today: "2026-11-21", items: json(await nextDue(home, "morse-code", "2026-11-21")) });
  });

  it("uses today by the app's clock without a date", async () => {
    const clock = { now: () => new Date("2026-11-21T23:30:00Z"), every: () => () => {} };
    const app = await startTestApp(
      (root) =>
        writeFile(join(root, "tomewise.json"), JSON.stringify({ formatVersion: 1, timezone: "Asia/Tokyo", weekStart: "monday" })),
      undefined,
      { clock },
    );

    const response = await app.get("/api/subjects/morse-code/unlocked");

    expect(response.body.today).toBe("2026-11-22");
  });

  it("gives 400 for a malformed date and 404 for an unknown subject", async () => {
    const app = await startTestApp();

    expect((await app.get("/api/subjects/morse-code/unlocked?date=soon")).status).toBe(400);
    expect((await app.get("/api/subjects/klingon/unlocked")).status).toBe(404);
  });
});

describe("GET /api/subjects/:subject/progress", () => {
  it("lists the lessons completed so far, first completed first, and each milestone's status", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/subjects/morse-code/progress");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      completedLessons: ["0001-k-and-m", "0002-r"],
      milestones: { "first-five": "current", "next-five": "upcoming" },
    });
  });

  it("gives 404 for an unknown subject", async () => {
    const app = await startTestApp();

    expect((await app.get("/api/subjects/klingon/progress")).status).toBe(404);
  });
});

describe("a subject's reference sheets", () => {
  it("are listed on the subject by file name", async () => {
    const app = await startTestApp(async (root) => {
      await mkdir(join(root, "subjects/morse-code/reference"), { recursive: true });
      await writeFile(join(root, "subjects/morse-code/reference/wpm-timing.html"), "<h1>WPM</h1>");
      await writeFile(join(root, "subjects/morse-code/reference/notes.txt"), "not a sheet");
    });

    const response = await app.get("/api/subjects/morse-code");

    expect(response.body.references).toEqual(["wpm-timing"]);
  });
});

describe("today, by the app's clock", () => {
  const clock = { now: () => new Date("2026-11-21T12:00:00Z"), every: () => () => {} };

  it("dates activity and what's due", async () => {
    const app = await startTestApp(undefined, undefined, { clock });
    const home = await loadLearningHome(app.root);

    expect((await app.get("/api/activity")).body.today).toBe("2026-11-21");
    expect((await app.get("/api/subjects/morse-code/due")).body).toEqual({ due: json(await dueItems(home, "morse-code", "2026-11-21")) });
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

  it("narrows days, streak and goals to one subject", async () => {
    const yoga = async (root: string) => {
      await shortSessionsCount(root);
      await mkdir(join(root, "subjects/yoga/events"), { recursive: true });
      await writeFile(join(root, "subjects/yoga/subject.json"), JSON.stringify({ name: "Yoga", goals: [{ id: "daily", per: "day", minutes: 10 }] }));
      const start = { id: "01KAY0000000000000000000S1", ts: "2026-11-20T07:00:00.000Z", subject: "yoga", kind: "session.start", ref: "drill:review", sessionId: "01KAY0000000000000000000S1", schemaVersion: 1, data: {} };
      const end = { ...start, id: "01KAY0000000000000000000E1", ts: "2026-11-20T07:06:00.000Z", kind: "session.end", duration: 360_000 };
      await writeFile(join(root, "subjects/yoga/events/2026-11.jsonl"), `${JSON.stringify(start)}\n${JSON.stringify(end)}\n`);
    };
    const app = await startTestApp(yoga);

    const response = await app.get("/api/activity?subject=yoga&to=2026-11-21");

    expect(response.status).toBe(200);
    expect(response.body.days).toEqual([{ date: "2026-11-20", subjects: ["yoga"], minutes: 6 }]);
    expect(response.body.streak.days).toBe(1);
    expect(response.body.goals.map((goal: any) => [goal.subject, goal.to, goal.minutes])).toEqual([
      ["yoga", "2026-11-20", 6],
      ["yoga", "2026-11-21", 0],
    ]);
  });

  it("gives 404 for an unknown subject", async () => {
    const app = await startTestApp();

    const response = await app.get("/api/activity?subject=klingon");

    expect(response.status).toBe(404);
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
    expect(activity.body.days).toEqual([{ date: "2026-11-22", subjects: ["morse-code"], minutes: 2 }]);
  });
});

describe("ask-your-agent prompts", () => {
  const base = { subject: "morse-code", schemaVersion: 2, data: {} };
  const lessonsDone = ["0003-s", "0004-the-late-bump"].map((lesson, index) => ({
    ...base,
    id: `01KAM0000000000000000000C${index}`,
    ts: "2026-11-22T09:00:00.000Z",
    kind: "lesson.completed",
    ref: `lesson:${lesson}`,
  }));
  const saved = {
    ...base,
    id: "01KAM0000000000000000000X1",
    ts: "2026-11-22T09:01:00.000Z",
    kind: "explanation.saved",
    ref: "lesson:0004-the-late-bump",
    data: { text: "The late bump is a short gap" },
  };
  const graded = {
    ...base,
    id: "01KAM0000000000000000000G1",
    ts: "2026-11-22T10:00:00.000Z",
    kind: "explanation.graded",
    ref: `event:${saved.id}`,
    data: { feedback: "Close: it's a longer gap" },
  };
  const examPrompt = {
    kind: "exam-unwritten",
    milestone: { id: "first-five", title: "Copy K, M, R, S and U" },
    exam: "first-five",
    say: "Prepare the exam for “Copy K, M, R, S and U”.",
  };
  const examUnwritten = (root: string) => rm(join(root, "subjects/morse-code/exams/first-five.html"));
  const gradePrompt = { kind: "ungraded-explanations", count: 1, refs: ["lesson:0004-the-late-bump"], say: "Grade my Morse code explanation." };
  const example = {
    id: "01M6ERETN0YYARVDHJG0T15Q2K",
    ts: "2026-11-02T18:31:00.000Z",
    ref: "lesson:0002-r",
    text: "R is dit-dah-dit. It is K backwards.",
    grade: {
      id: "01M6EXHSG0K3Q8WZ7N5TB2FD9C",
      ts: "2026-11-02T20:00:00.000Z",
      feedback: "Close. R is dit-dah-dit and K is dah-di-dah, so R is K with dits and dahs swapped, not reversed. Reversed, R reads the same.",
    },
  };

  it("are empty while nothing needs the agent", async () => {
    const app = await startTestApp();

    expect((await app.get("/api/subjects/morse-code/prompts")).body).toEqual({ prompts: [], explanations: [example] });
    expect((await app.get("/api/prompts")).body).toEqual({ subjects: [] });
  });

  it("come and go with the events, and explanations carry the agent's feedback", async () => {
    const app = await startTestApp(examUnwritten);

    expect((await app.post([...lessonsDone, saved])).status).toBe(201);
    const waiting = await app.get("/api/subjects/morse-code/prompts");
    expect(waiting.status).toBe(200);
    expect(waiting.body).toEqual({
      prompts: [examPrompt, gradePrompt],
      explanations: [{ id: saved.id, ts: saved.ts, ref: saved.ref, text: saved.data.text }, example],
    });
    expect((await app.get("/api/prompts")).body).toEqual({ subjects: [{ subject: "morse-code", prompts: [examPrompt, gradePrompt] }] });

    expect((await app.post([graded])).status).toBe(201);
    const after = await app.get("/api/subjects/morse-code/prompts");
    expect(after.body).toEqual({
      prompts: [examPrompt],
      explanations: [
        { id: saved.id, ts: saved.ts, ref: saved.ref, text: saved.data.text, grade: { id: graded.id, ts: graded.ts, feedback: graded.data.feedback } },
        example,
      ],
    });
  });

  it("give 404 for an unknown subject", async () => {
    const app = await startTestApp();

    expect((await app.get("/api/subjects/klingon/prompts")).status).toBe(404);
  });
});

describe("GET /api/subjects/:subject/quiz/due", () => {
  const clock = (at: string) => ({ now: () => new Date(at), every: () => () => {} });
  const weekly = async (root: string) => {
    const file = join(root, "subjects/morse-code/subject.json");
    const subject = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...subject, settings: { assessments: { quizFrequency: "weekly" } } }));
    await rm(join(root, "subjects/morse-code/quizzes/k-m-r.html"));
  };

  it("gives the due quiz slot by the app's clock, and none once a quiz is taken", async () => {
    const app = await startTestApp(weekly, undefined, { clock: clock("2026-11-21T12:00:00Z") });

    expect((await app.get("/api/subjects/morse-code/quiz/due")).body).toEqual({ quiz: { opened: "2026-11-16T00:00:00.000Z" } });
    const prompts = (await app.get("/api/subjects/morse-code/prompts")).body.prompts;
    expect(prompts).toContainEqual({ kind: "quiz-unwritten", quiz: { opened: "2026-11-16T00:00:00.000Z" }, say: "Write the Morse code quiz that's due." });

    const session = { subject: "morse-code", ref: "drill:quiz-2026-11-21", sessionId: "01KAQ0000000000000000000S1", schemaVersion: 2 };
    const taken = [
      { ...session, id: session.sessionId, ts: "2026-11-21T11:00:00.000Z", kind: "session.start", data: {} },
      { ...session, id: "01KAQ0000000000000000000E1", ts: "2026-11-21T11:05:00.000Z", kind: "session.end", duration: 300_000, score: 80 },
    ];
    expect((await app.post(taken)).status).toBe(201);
    expect((await app.get("/api/subjects/morse-code/quiz/due")).body).toEqual({ quiz: null });
    expect((await app.get("/api/prompts")).body).toEqual({ subjects: [] });
  });

  it("gives none before 5 lessons are done, and 404 for an unknown subject", async () => {
    const app = await startTestApp(undefined, undefined, { clock: clock("2026-11-21T12:00:00Z") });

    expect((await app.get("/api/subjects/morse-code/quiz/due")).body).toEqual({ quiz: null });
    expect((await app.get("/api/subjects/klingon/quiz/due")).status).toBe(404);
  });
});
