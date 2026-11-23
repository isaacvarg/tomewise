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

export interface QuizResult extends ScoreResult {
  subject: string;
  quiz: string;
  sessionId: string;
}

export interface ClosedExams {
  inputs: unknown[];
  exams: ExamResult[];
  quizzes: QuizResult[];
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

export function quizResult(
  subject: Pick<Subject, "id" | "settings">,
  events: readonly LearningEvent[],
  sessionId: string,
  quiz: string,
  questions: readonly string[] = [],
): QuizResult {
  return { subject: subject.id, quiz, sessionId, ...judged(sessionScore(events, sessionId, questions), subject.settings.assessments.passMark) };
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

async function readQuestions(home: LearningHome, subject: string, folder: "exams" | "quizzes", page: string): Promise<string[]> {
  try {
    return examQuestions(await readFile(join(home.root, subjectPath(subject, folder, `${page}.html`)), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

interface ScoredEnd {
  input: Record<string, unknown>;
  subject: string;
  sessionId: string;
  kind: "exam" | "quiz";
  page: string;
}

function scoredEnd(input: unknown, home: LearningHome): ScoredEnd | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const fields = input as Record<string, unknown>;
  const { kind, subject, sessionId, ref } = fields;
  if (kind !== "session.end" || typeof subject !== "string" || typeof sessionId !== "string" || typeof ref !== "string") return undefined;
  const parsed = parseRef(ref);
  if ((parsed?.kind !== "exam" && parsed?.kind !== "quiz") || !home.subjects.includes(subject)) return undefined;
  return { input: fields, subject, sessionId, kind: parsed.kind, page: parsed.id };
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
  const quizzes: QuizResult[] = [];
  for (const input of inputs) {
    const end = scoredEnd(input, home);
    if (!end) {
      closed.push(input);
      continue;
    }
    const { subject, events } = await load(end.subject);
    if (!(end.kind === "exam" ? subject.exams : subject.quizzes).includes(end.page)) {
      closed.push(input);
      continue;
    }
    if (end.kind === "quiz") {
      const result = quizResult(subject, events, end.sessionId, end.page, await readQuestions(home, end.subject, "quizzes", end.page));
      closed.push({ ...end.input, score: result.score });
      quizzes.push(result);
      continue;
    }
    const result = examResult(subject, events, end.sessionId, end.page, await readQuestions(home, end.subject, "exams", end.page));
    closed.push(...examEvents(subject, events, end.input, result));
    exams.push(result);
  }
  return { inputs: closed, exams, quizzes };
}
