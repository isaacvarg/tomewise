import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { loadLearningHome } from "@tomewise/core";
import { copyExample, writeFiles } from "../../core/test/helpers.ts";
import { type HomeView, watchLearningHome } from "../src/index.ts";
import { startTestApp } from "./harness.ts";

const SUBJECT = "subjects/morse-code";

const letterE = {
  id: "letter-e",
  type: "timed-audio",
  audio: "assets/audio/k.wav",
  answer: "E",
  timeLimitSeconds: 5,
  unlockedBy: "0003-s",
  tags: ["letter"],
};

function sessionStart(subject: string) {
  return { subject, kind: "session.start", ref: "lesson:0001-k-and-m", schemaVersion: 2, data: {} };
}

function poll<T>(read: () => Promise<T>) {
  return expect.poll(read, { timeout: 3000, interval: 25 });
}

describe("watcher", () => {
  it("shows an item set added while the app runs", async () => {
    const app = await startTestApp();
    expect((await app.get("/api/subjects/morse-code")).body.itemSets).toHaveLength(4);

    await writeFile(join(app.root, SUBJECT, "items/0005-e.json"), JSON.stringify([letterE]));

    await poll(async () => (await app.get("/api/subjects/morse-code")).body.items.map((item: any) => item.id)).toContain(
      "letter-e",
    );
  });

  it("shows a lesson added while the app runs", async () => {
    const app = await startTestApp();

    await writeFile(join(app.root, SUBJECT, "lessons/0005-e.html"), "<!doctype html><title>E</title>");

    await poll(async () => (await app.get("/api/subjects/morse-code")).body.lessons).toContain("0005-e");
  });

  it("makes a subject added while the app runs reachable", async () => {
    const app = await startTestApp();
    expect((await app.get("/api/subjects/flags")).status).toBe(404);

    await writeFiles(app.root, { "subjects/flags/subject.json": { name: "Flags" } });

    await poll(async () => (await app.get("/api/subjects/flags")).status).toBe(200);
    expect((await app.get("/api/subjects")).body.subjects.map((subject: any) => subject.id)).toEqual(["flags", "morse-code"]);
    expect((await app.get("/api/subjects/flags/events")).body).toEqual({ events: [] });
  });

  it("serves pages of a subject added while the app runs", async () => {
    const app = await startTestApp();
    expect((await app.raw("/s/flags/reference/colours.html")).status).toBe(404);

    await writeFiles(app.root, {
      "subjects/flags/subject.json": { name: "Flags" },
      "subjects/flags/reference/colours.html": "<!doctype html><title>Colours</title>",
    });

    await poll(async () => (await app.raw("/s/flags/reference/colours.html")).status).toBe(200);
  });

  it("accepts events for a subject added while the app runs", async () => {
    const app = await startTestApp();
    await cp(join(app.root, SUBJECT), join(app.root, "subjects/morse-two"), { recursive: true });
    await poll(async () => (await app.get("/api/subjects/morse-two")).status).toBe(200);

    const response = await app.post(sessionStart("morse-two"));

    expect(response.status).toBe(201);
  });

  it("picks up tomewise.json changes", async () => {
    const app = await startTestApp();
    expect((await app.get("/api/subjects/morse-code")).body.settings.minimumSessionSeconds).toBe(60);

    await writeFiles(app.root, {
      "tomewise.json": { formatVersion: 1, timezone: "Europe/London", weekStart: "monday", minimumSessionSeconds: 1 },
    });

    await poll(async () => (await app.get("/api/subjects/morse-code")).body.settings.minimumSessionSeconds).toBe(1);
  });

  it("keeps serving the last good view while a file is broken", async () => {
    const app = await startTestApp();
    await writeFile(join(app.root, "tomewise.json"), "{ not json");
    await writeFile(join(app.root, SUBJECT, "lessons/0005-e.html"), "<!doctype html><title>E</title>");
    await poll(async () => app.reloadErrors.length).toBeGreaterThan(0);

    const response = await app.get("/api/subjects/morse-code");

    expect(response.status).toBe(200);
    expect(response.body.lessons).toHaveLength(4);
  });

  it("serves the app's own appended events at once", async () => {
    const app = await startTestApp();

    const posted = await app.post(sessionStart("morse-code"));
    const response = await app.get("/api/subjects/morse-code/events?from=2000-01-01");

    expect(response.body.events.map((event: any) => event.id)).toContain(posted.body.events[0].id);
  });
});

describe("watchLearningHome", () => {
  async function watched() {
    const root = await copyExample("morse");
    const home = await watchLearningHome(await loadLearningHome(root), { onError: (error) => expect.fail(String(error)) });
    onTestFinished(() => home.close());
    return { root, home };
  }

  it("tells listeners the view before and after a change", async () => {
    const { root, home } = await watched();
    const reloads: [HomeView, HomeView][] = [];
    home.onReload((next, previous) => void reloads.push([next, previous]));

    await writeFile(join(root, SUBJECT, "lessons/0005-e.html"), "<!doctype html><title>E</title>");

    await poll(async () => reloads.length).toBeGreaterThan(0);
    const [next, previous] = reloads.at(-1)!;
    expect(previous.subjects.get("morse-code")!.lessons).not.toContain("0005-e");
    expect(next.subjects.get("morse-code")!.lessons).toContain("0005-e");
    expect(home.current()).toBe(next);
  });

  it("does not reload for the app's own event appends", async () => {
    const { root, home } = await watched();
    let reloads = 0;
    home.onReload(() => void reloads++);

    await writeFile(join(root, SUBJECT, "events/2026-12.jsonl"), "");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(reloads).toBe(0);
  });

  it("stops reloading once closed", async () => {
    const { root, home } = await watched();
    let reloads = 0;
    home.onReload(() => void reloads++);
    const before = home.current();

    await home.close();
    await writeFile(join(root, SUBJECT, "lessons/0005-e.html"), "<!doctype html><title>E</title>");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(reloads).toBe(0);
    expect(home.current()).toBe(before);
  });
});
