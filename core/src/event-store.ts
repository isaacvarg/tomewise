import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { checkAgainstSubject, historyOf, type History } from "./event-checks.ts";
import { InvalidEventError, InvalidLearningHomeError, SubjectNotFoundError } from "./errors.ts";
import { EventEnvelope, type LearningEvent } from "./events.ts";
import { issuesFrom, type ValidationIssue } from "./issues.ts";
import { loadSubject, type LearningHome } from "./load.ts";
import { SUBJECTS_DIR, subjectPath, type Subject } from "./subject.ts";
import { ulid } from "./ulid.ts";

export type EventTarget = "main" | { machine: string };

export interface AppendOptions {
  target: EventTarget;
  now?: Date;
}

const EVENT = "event";
const EVENT_FILE = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:\.([a-z0-9]+(?:-[a-z0-9]+)*))?\.jsonl$/;

export interface EventLine {
  event: LearningEvent;
  file: string;
  fileMonth: string;
  line: number;
}

export interface EventScan {
  lines: EventLine[];
  issues: ValidationIssue[];
  otherFiles: string[];
}

export function monthOf(ts: string): string {
  return ts.slice(0, 7);
}

export function machineName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "machine";
}

async function eventFiles(root: string, subject: string): Promise<{ name: string; month?: string }[]> {
  let names: string[];
  try {
    names = await readdir(join(root, SUBJECTS_DIR, subject, "events"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names.sort().map((name) => ({ name, month: EVENT_FILE.exec(name)?.[1] }));
}

export async function scanEvents(
  root: string,
  subject: string,
  wantMonth: (month: string) => boolean = () => true,
): Promise<EventScan> {
  const lines: EventLine[] = [];
  const issues: ValidationIssue[] = [];
  const otherFiles: string[] = [];
  for (const { name, month: fileMonth } of await eventFiles(root, subject)) {
    const file = subjectPath(subject, "events", name);
    if (!fileMonth) {
      otherFiles.push(file);
      continue;
    }
    if (!wantMonth(fileMonth)) continue;
    const text = await readFile(join(root, file), "utf8");
    text.split("\n").forEach((raw, index) => {
      const line = index + 1;
      if (raw.trim() === "") return;
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch (error) {
        issues.push({ file, line, path: "", message: `Invalid JSON: ${(error as Error).message}` });
        return;
      }
      const parsed = EventEnvelope.safeParse(value);
      if (!parsed.success) {
        issues.push(...issuesFrom(file, parsed.error).map((issue) => ({ ...issue, line })));
        return;
      }
      lines.push({ event: parsed.data, file, fileMonth, line });
    });
  }
  return { lines, issues, otherFiles };
}

export interface EventRange {
  from?: Date | string;
  to?: Date | string;
}

function instant(value: Date | string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const time = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (Number.isNaN(time)) throw new RangeError(`Not a date: ${String(value)}`);
  return time;
}

function monthSpan(month: string): [number, number] {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return [Date.UTC(year, m - 1, 1), Date.UTC(year, m, 1)];
}

export async function readEvents(home: LearningHome, subject: string, range: EventRange = {}): Promise<LearningEvent[]> {
  if (!home.subjects.includes(subject)) {
    throw new SubjectNotFoundError(`No subject "${subject}" in ${home.root}. Subjects: ${home.subjects.join(", ") || "none"}`);
  }
  const from = instant(range.from, -Infinity);
  const to = instant(range.to, Infinity);
  const scan = await scanEvents(home.root, subject, (month) => {
    const [start, end] = monthSpan(month);
    return start < to && end > from;
  });
  if (scan.issues.length > 0) throw new InvalidLearningHomeError(scan.issues);
  return scan.lines
    .map(({ event }) => ({ event, time: Date.parse(event.ts) }))
    .filter(({ time }) => time >= from && time < to)
    .sort((a, b) => a.time - b.time || (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0))
    .map(({ event }) => event);
}

function withGenerated(input: unknown, now: Date): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const event: Record<string, unknown> = { ...input };
  event.id ??= ulid(now.getTime());
  event.ts ??= now.toISOString();
  if (event.kind === "session.start") event.sessionId ??= event.id;
  return event;
}

function fileName(month: string, target: EventTarget): string {
  return target === "main" ? `${month}.jsonl` : `${month}.${machineName(target.machine)}.jsonl`;
}

let queue: Promise<unknown> = Promise.resolve();

function queued<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => undefined);
  return result;
}

export interface AppendedEvent {
  event: LearningEvent;
  file: string;
}

export async function appendEvent(home: LearningHome, input: unknown, options: AppendOptions): Promise<AppendedEvent> {
  const [appended] = await queued(() => validateAndAppend(home, [input], options, () => EVENT));
  return appended!;
}

export function appendEvents(home: LearningHome, inputs: unknown[], options: AppendOptions): Promise<AppendedEvent[]> {
  return queued(() => validateAndAppend(home, inputs, options, (index) => `events[${index}]`));
}

interface Known {
  subject: Subject;
  history: History;
}

async function validateAndAppend(
  home: LearningHome,
  inputs: unknown[],
  options: AppendOptions,
  label: (index: number) => string,
): Promise<AppendedEvent[]> {
  const now = options.now ?? new Date();
  const known = new Map<string, Known>();
  const accepted: AppendedEvent[] = [];
  const issues: ValidationIssue[] = [];

  for (const [index, input] of inputs.entries()) {
    const file = label(index);
    const parsed = EventEnvelope.safeParse(withGenerated(input, now));
    if (!parsed.success) {
      issues.push(...issuesFrom(file, parsed.error));
      continue;
    }
    const event: LearningEvent = parsed.data;
    if (!home.subjects.includes(event.subject)) {
      issues.push({
        file,
        path: "subject",
        message: `No subject "${event.subject}"; subjects: ${home.subjects.join(", ") || "none"}`,
      });
      continue;
    }
    let subject = known.get(event.subject);
    if (!subject) {
      subject = {
        subject: await loadSubject(home, event.subject),
        history: historyOf((await scanEvents(home.root, event.subject)).lines.map((line) => line.event)),
      };
      known.set(event.subject, subject);
    }
    const eventIssues: ValidationIssue[] = [];
    if (subject.history.byId.has(event.id)) eventIssues.push({ file, path: "id", message: `Event id "${event.id}" is already used` });
    eventIssues.push(...checkAgainstSubject(event, subject.subject, subject.history).map((issue) => ({ file, ...issue })));
    if (eventIssues.length > 0) {
      issues.push(...eventIssues);
      continue;
    }
    subject.history.byId.set(event.id, event);
    accepted.push({ event, file: subjectPath(event.subject, "events", fileName(monthOf(event.ts), options.target)) });
  }
  if (issues.length > 0) throw new InvalidEventError(issues);

  for (const [file, group] of Map.groupBy(accepted, (appended) => appended.file)) {
    const full = join(home.root, file);
    await mkdir(dirname(full), { recursive: true });
    await appendFile(full, group.map(({ event }) => `${JSON.stringify(event)}\n`).join(""));
  }
  return accepted;
}
