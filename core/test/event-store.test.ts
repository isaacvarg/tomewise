import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent, InvalidEventError, loadLearningHome, readEvents } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SESSION = "01KAJ0000000000000000000S1";
const EVENTS = "subjects/morse-code/events";

const files = {
  "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
  "subjects/morse-code/subject.json": { name: "Morse code" },
  "subjects/morse-code/lessons/0001-k-and-m.html": "<h1>K and M</h1>",
  "subjects/morse-code/items/0001-k-and-m.json": [
    { id: "letter-k", type: "timed-audio", answer: "K", audio: "k.wav", unlockedBy: "0001-k-and-m" },
  ],
};

const sessionStart = {
  id: SESSION,
  ts: "2026-11-03T18:00:00.000Z",
  subject: "morse-code",
  kind: "session.start",
  ref: "lesson:0001-k-and-m",
  sessionId: SESSION,
  schemaVersion: 1,
};

function nth(event: { ts: string }): number {
  return new Date(event.ts).getUTCMilliseconds();
}

function attempt(n: number, extra: Record<string, unknown> = {}) {
  return {
    ts: new Date(Date.UTC(2026, 10, 3, 18, 1, 0, n)).toISOString(),
    subject: "morse-code",
    kind: "attempt",
    ref: "item:letter-k",
    sessionId: SESSION,
    outcome: "correct",
    grade: 3,
    schemaVersion: 1,
    ...extra,
  };
}

async function rawLines(root: string, name: string): Promise<string[]> {
  const text = await readFile(join(root, EVENTS, name), "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text.slice(0, -1).split("\n");
}

async function started() {
  const root = await buildHome(files);
  const home = await loadLearningHome(root);
  await appendEvent(home, sessionStart, { target: "main" });
  return { root, home };
}

describe("choosing where an event is appended", () => {
  it("appends to the main monthly file", async () => {
    const { root, home } = await started();

    const { file } = await appendEvent(home, attempt(1), { target: "main" });

    expect(file).toBe(`${EVENTS}/2026-11.jsonl`);
    expect(await readdir(join(root, EVENTS))).toEqual(["2026-11.jsonl"]);
    expect((await rawLines(root, "2026-11.jsonl")).map((line) => JSON.parse(line).kind)).toEqual([
      "session.start",
      "attempt",
    ]);
  });

  it("appends to this machine's monthly file", async () => {
    const { root, home } = await started();

    const { file } = await appendEvent(home, attempt(1), { target: { machine: "Isaacs-Laptop.local" } });

    expect(file).toBe(`${EVENTS}/2026-11.isaacs-laptop-local.jsonl`);
    expect(await readdir(join(root, EVENTS))).toEqual(["2026-11.isaacs-laptop-local.jsonl", "2026-11.jsonl"]);
    expect(await rawLines(root, "2026-11.isaacs-laptop-local.jsonl")).toHaveLength(1);
  });

  it("reads events back from both files", async () => {
    const { home } = await started();
    await appendEvent(home, attempt(1), { target: { machine: "laptop" } });
    await appendEvent(home, attempt(2), { target: "main" });

    const events = await readEvents(home, "morse-code");

    expect(events.map((event) => [event.kind, nth(event)])).toEqual([
      ["session.start", 0],
      ["attempt", 1],
      ["attempt", 2],
    ]);
  });

  it("checks duplicate ids across both files", async () => {
    const { home } = await started();

    const error = await appendEvent(home, sessionStart, { target: { machine: "laptop" } }).catch((e: unknown) => e);

    expect((error as InvalidEventError).issues).toEqual([
      { file: "event", path: "id", message: `Event id "${SESSION}" is already used` },
    ]);
  });
});

describe("appending concurrently", () => {
  it("writes every event as a whole line, none lost", async () => {
    const { root, home } = await started();
    const count = 60;

    await Promise.all(
      Array.from({ length: count }, (_, n) =>
        appendEvent(home, attempt(n), { target: n % 3 === 0 ? { machine: "laptop" } : "main" }),
      ),
    );

    const lines = [...(await rawLines(root, "2026-11.jsonl")), ...(await rawLines(root, "2026-11.laptop.jsonl"))];
    const events = lines.map((line) => JSON.parse(line));
    expect(events).toHaveLength(count + 1);
    expect(new Set(events.map((event) => event.id)).size).toBe(count + 1);
    expect(events.filter((event) => event.kind === "attempt").map(nth).sort((a, b) => a - b)).toEqual(
      Array.from({ length: count }, (_, n) => n),
    );
  });

  it("accepts only the first of two events with the same id", async () => {
    const { root, home } = await started();
    const id = "01KAJ0000000000000000000A1";

    const results = await Promise.allSettled([
      appendEvent(home, attempt(1, { id }), { target: "main" }),
      appendEvent(home, attempt(2, { id }), { target: { machine: "laptop" } }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(InvalidEventError);
    expect(await readdir(join(root, EVENTS))).toEqual(["2026-11.jsonl"]);
  });

  it("keeps appending after a rejected event", async () => {
    const { home } = await started();

    const results = await Promise.allSettled([
      appendEvent(home, attempt(1, { ref: "item:letter-z" }), { target: "main" }),
      appendEvent(home, attempt(2), { target: "main" }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
  });
});

describe("owning event files", () => {
  it("is the only source module that writes files under events/", async () => {
    const sources = new URL("../../", import.meta.url);
    const writers: string[] = [];
    for (const dir of ["core/src", "cli/src", "app/src"]) {
      for (const name of await readdir(new URL(dir, sources), { recursive: true })) {
        if (!name.endsWith(".ts")) continue;
        const text = await readFile(new URL(`${dir}/${name}`, sources), "utf8");
        if (/\b(appendFile|writeFile|createWriteStream)/.test(text)) writers.push(`${dir}/${name}`);
      }
    }

    const notEvents = ["core/src/json-schemas.ts", "core/src/init.ts", "core/src/settings.ts", "core/src/generated-files.ts", "core/src/updates.ts", "cli/src/import.ts", "cli/src/service.ts"];
    expect(writers.filter((file) => !notEvents.includes(file))).toEqual(["core/src/event-store.ts"]);
  });
});
