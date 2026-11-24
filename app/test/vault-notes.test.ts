import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLearningHome, rebuildVault } from "@tomewise/core";
import { snapshot, writeFiles } from "../../core/test/helpers.ts";
import { startTestApp } from "./harness.ts";

const SESSION = "01KAJ0000000000000000000S1";
const NOTE = `sessions/morse-code/2026-11-21-${SESSION}.md`;

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

function attempt(n: number, outcome: string) {
  return {
    ts: new Date(Date.UTC(2026, 10, 21, 18, n, 0)).toISOString(),
    subject: "morse-code",
    kind: "attempt",
    ref: n % 2 === 0 ? "item:letter-m" : "item:letter-k",
    sessionId: SESSION,
    duration: 600,
    outcome,
    grade: outcome === "correct" ? 3 : 1,
    schemaVersion: 2,
    data: { heard: "K", answer: "K", responseTime: 600, wpm: 18 },
  };
}

const end = {
  ts: "2026-11-21T18:06:00.000Z",
  subject: "morse-code",
  kind: "session.end",
  ref: "lesson:0001-k-and-m",
  sessionId: SESSION,
  duration: 360_000,
  schemaVersion: 2,
  data: {},
};

async function vaultMode(root: string, vault: Record<string, unknown> | undefined) {
  const file = join(root, "tomewise.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), vault }));
}

async function read(root: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

describe("writing a session's note when it ends", () => {
  it("writes the note on session.end with the session's frontmatter", async () => {
    const app = await startTestApp((root) => vaultMode(root, {}));

    await app.post([start, attempt(1, "correct"), attempt(2, "wrong")]);
    expect(await read(app.root, NOTE)).toBeUndefined();
    const response = await app.post(end);

    expect(response.status).toBe(201);
    const note = await read(app.root, NOTE);
    expect(note?.split("\n---\n")[0]).toBe(
      [
        "---",
        "generatedBy: tomewise",
        'subject: "morse-code"',
        "date: 2026-11-21",
        'ref: "lesson:0001-k-and-m"',
        "durationMin: 6",
        "attempts: 2",
        "correct: 1",
        "wrong: 1",
        "skipped: 0",
        'lesson: "0001-k-and-m"',
      ].join("\n"),
    );
  });

  it("writes the same bytes a later tome vault rebuild writes", async () => {
    const app = await startTestApp((root) => vaultMode(root, {}));
    await app.post([start, attempt(1, "correct"), attempt(2, "wrong"), end]);
    const live = await read(app.root, NOTE);

    await rebuildVault(await loadLearningHome(app.root));

    expect(live).toBeDefined();
    expect(await read(app.root, NOTE)).toBe(live);
  });

  it("uses the configured notes folder", async () => {
    const app = await startTestApp((root) => vaultMode(root, { notesFolder: "journal/tomewise" }));

    await app.post([start, attempt(1, "correct"), end]);

    expect(await read(app.root, `journal/tomewise/morse-code/2026-11-21-${SESSION}.md`)).toMatch(/^---\ngeneratedBy: tomewise\n/);
  });

  it("writes no notes with vault mode off", async () => {
    const app = await startTestApp();
    const before = await snapshot(app.root);

    await app.post([start, attempt(1, "correct"), end]);

    const after = await snapshot(app.root);
    expect(Object.keys(after).filter((path) => !(path in before))).toEqual([]);
  });

  it("still records the session, with a warning, when its note can't be written", async () => {
    const app = await startTestApp(async (root) => {
      await vaultMode(root, {});
      await mkdir(join(root, NOTE), { recursive: true });
    });
    const before = await app.lines("2026-11.jsonl");

    const response = await app.post([start, attempt(1, "correct"), end]);

    expect(response.status).toBe(201);
    expect(await app.lines("2026-11.jsonl")).toEqual([...before, ...response.body.events]);
    expect(app.warnings).toEqual([expect.stringContaining(`Couldn't write the session note for ${SESSION}`)]);
  });

  it("leaves the learner's own files alone", async () => {
    const mine = "---\ntitle: my own note\n---\n\nKeep this.\n";
    const app = await startTestApp(async (root) => {
      await vaultMode(root, {});
      await writeFiles(root, { [NOTE]: mine, "sessions/morse-code/thoughts.md": "Morse is fun.\n" });
    });
    const before = await snapshot(app.root);

    const response = await app.post([start, attempt(1, "correct"), end]);

    expect(response.status).toBe(201);
    const after = await snapshot(app.root);
    const changed = Object.keys(after).filter((path) => after[path] !== before[path]);
    expect(changed).toEqual(["subjects/morse-code/events/2026-11.jsonl"]);
  });
});
