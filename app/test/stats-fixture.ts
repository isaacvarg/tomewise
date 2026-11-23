import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MORSE = "subjects/morse-code";

let counter = 0;
const nextId = () => `01KB0${String(++counter).padStart(21, "0")}`;

function session(ts: string, minutes: number, outcomes: ("correct" | "wrong")[] = []) {
  const id = nextId();
  const base = { subject: "morse-code", ref: "drill:review", sessionId: id, schemaVersion: 2, data: {} };
  const attempts = outcomes.map((outcome, index) => ({
    ...base,
    id: nextId(),
    ts: new Date(Date.parse(ts) + (index + 1) * 1000).toISOString(),
    kind: "attempt",
    ref: "item:letter-k",
    outcome,
    grade: outcome === "correct" ? 3 : 1,
    data: { heard: "K", answer: "K", responseTime: 1000 + 100 * index, wpm: 18 },
  }));
  const end = { ...base, id: nextId(), ts: new Date(Date.parse(ts) + minutes * 60_000).toISOString(), kind: "session.end", duration: minutes * 60_000 };
  return [{ ...base, id, ts, kind: "session.start" }, ...attempts, end];
}

export const EVENTS = [
  ...session("2026-10-01T08:00:00.000Z", 20, ["wrong", "wrong"]),
  ...session("2026-11-19T08:00:00.000Z", 10, ["correct", "wrong", "correct"]),
  ...session("2026-11-21T08:00:00.000Z", 5, ["correct"]),
];

export const CHARTS = [
  { id: "response-time", title: "Response time", kind: "line", measure: "payload", field: "responseTime", days: 3 },
  { id: "minutes", title: "Minutes a day", kind: "bar", measure: "minutes", days: 3 },
];

export async function withFixture(root: string, charts: unknown[] = CHARTS) {
  const subjectPath = join(root, MORSE, "subject.json");
  const subject = JSON.parse(await readFile(subjectPath, "utf8"));
  await writeFile(subjectPath, JSON.stringify({ ...subject, charts }));
  await rm(join(root, MORSE, "events"), { recursive: true });
  await mkdir(join(root, MORSE, "events"));
  await writeFile(join(root, MORSE, "events", "2026-11.jsonl"), EVENTS.map((event) => JSON.stringify(event)).join("\n") + "\n");
}
