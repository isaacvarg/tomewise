import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readEvents } from "./event-store.ts";
import { type LearningEvent, parseRef } from "./events.ts";
import { type LearningHome, loadSubject } from "./load.ts";
import { milestoneStatusesOf } from "./milestones.ts";
import { judged, type ScoreResult, sessionScore } from "./score.ts";
import { subjectPath, type Subject } from "./subject.ts";

type Milestone = NonNullable<Subject["curriculum"]>["units"][number]["milestones"][number];

export interface ExamResult extends ScoreResult {
  subject: string;
  exam: string;
  sessionId: string;
  milestone?: string;
}

export interface ClosedExams {
  inputs: unknown[];
  exams: ExamResult[];
}

const QUESTION = /<tome-exam-question\b[^>]*?\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

export function examQuestions(html: string): string[] {
  const ids = [...html.matchAll(QUESTION)].map((match) => match[1] ?? match[2] ?? match[3]!).filter(Boolean);
  return [...new Set(ids)];
}

export function examMilestone(subject: Pick<Subject, "curriculum">, exam: string): Milestone | undefined {
  return subject.curriculum?.units.flatMap((unit) => unit.milestones).find((milestone) => milestone.exam === exam);
}

export function examPassMark(subject: Pick<Subject, "curriculum" | "settings">, exam: string): number {
  return examMilestone(subject, exam)?.passMark ?? subject.settings.assessments.passMark;
}

export function examResult(
  subject: Pick<Subject, "id" | "curriculum" | "settings">,
  events: readonly LearningEvent[],
  sessionId: string,
  exam: string,
  questions: readonly string[] = [],
): ExamResult {
  const milestone = examMilestone(subject, exam);
  return {
    subject: subject.id,
    exam,
    sessionId,
    ...(milestone && { milestone: milestone.id }),
    ...judged(sessionScore(events, sessionId, questions), examPassMark(subject, exam)),
  };
}

export function examEvents(subject: Pick<Subject, "curriculum">, events: readonly LearningEvent[], end: Record<string, unknown>, result: ExamResult): Record<string, unknown>[] {
  const closed = [{ ...end, score: result.score }];
  if (!result.passed || result.milestone === undefined) return closed;
  if (milestoneStatusesOf(subject, events)[result.milestone] === "done") return closed;
  return [
    ...closed,
    {
      subject: end.subject,
      kind: "milestone.status",
      ref: `milestone:${result.milestone}`,
      sessionId: result.sessionId,
      schemaVersion: end.schemaVersion,
      data: { status: "done" },
    },
  ];
}

async function readQuestions(home: LearningHome, subject: string, exam: string): Promise<string[]> {
  try {
    return examQuestions(await readFile(join(home.root, subjectPath(subject, "exams", `${exam}.html`)), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

interface ExamEnd {
  input: Record<string, unknown>;
  subject: string;
  sessionId: string;
  exam: string;
}

function examEnd(input: unknown, home: LearningHome): ExamEnd | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const fields = input as Record<string, unknown>;
  const { kind, subject, sessionId, ref } = fields;
  if (kind !== "session.end" || typeof subject !== "string" || typeof sessionId !== "string" || typeof ref !== "string") return undefined;
  const parsed = parseRef(ref);
  if (parsed?.kind !== "exam" || !home.subjects.includes(subject)) return undefined;
  return { input: fields, subject, sessionId, exam: parsed.id };
}

export async function closeExams(home: LearningHome, inputs: readonly unknown[]): Promise<ClosedExams> {
  const loaded = new Map<string, Promise<{ subject: Subject; events: LearningEvent[] }>>();
  const load = (id: string) => {
    let entry = loaded.get(id);
    if (!entry) {
      entry = Promise.all([loadSubject(home, id), readEvents(home, id)]).then(([subject, events]) => ({ subject, events }));
      loaded.set(id, entry);
    }
    return entry;
  };
  const closed: unknown[] = [];
  const exams: ExamResult[] = [];
  for (const input of inputs) {
    const end = examEnd(input, home);
    if (!end) {
      closed.push(input);
      continue;
    }
    const { subject, events } = await load(end.subject);
    if (!subject.exams.includes(end.exam)) {
      closed.push(input);
      continue;
    }
    const result = examResult(subject, events, end.sessionId, end.exam, await readQuestions(home, end.subject, end.exam));
    closed.push(...examEvents(subject, events, end.input, result));
    exams.push(result);
  }
  return { inputs: closed, exams };
}
