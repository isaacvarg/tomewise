import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startTestApp } from "./harness.ts";

function sessionStart() {
  return { subject: "morse-code", kind: "session.start", ref: "lesson:0001-k-and-m", schemaVersion: 2, data: {} };
}

function poll<T>(read: () => T | Promise<T>) {
  return expect.poll(read, { timeout: 3000, interval: 25 });
}

describe("GET /api/changes", () => {
  it("announces a batch of posted events, naming the subjects but not the events", async () => {
    const app = await startTestApp();
    const stream = await app.changes();
    expect(stream.status).toBe(200);
    expect(stream.type).toMatch(/^text\/event-stream/);

    await app.post([sessionStart(), sessionStart()]);

    await poll(() => stream.received).toEqual([{ event: "events", data: { subjects: ["morse-code"] } }]);
  });

  it("announces each content reload from the watcher", async () => {
    const app = await startTestApp();
    const stream = await app.changes();

    await writeFile(join(app.root, "subjects/morse-code/lessons/0005-e.html"), "<!doctype html><title>E</title>");

    await poll(() => stream.received).toEqual([{ event: "content", data: {} }]);
  });

  it("ends the stream when the server stops, so the page can reconnect to the next one", async () => {
    const app = await startTestApp();
    const stream = await app.changes();

    await app.stop();

    await poll(() => stream.ended).toBe(true);
  });
});
