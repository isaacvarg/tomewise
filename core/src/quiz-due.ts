import { isoDate, localDay, weekOf } from "./activity.ts";
import { isQuizDrillId } from "./drills.ts";
import { endOfDay } from "./due.ts";
import { type LearningEvent, parseRef } from "./events.ts";
import type { Subject } from "./subject.ts";

export interface QuizSlot {
  opened: string;
  after?: string;
}

const timeOf = (event: LearningEvent) => Date.parse(event.ts);

function isQuizTaken(event: LearningEvent): boolean {
  const ref = event.kind === "session.end" && event.score !== undefined && event.ref !== undefined ? parseRef(event.ref) : undefined;
  return ref?.kind === "quiz" || (ref?.kind === "drill" && isQuizDrillId(ref.id));
}

function lessonSlots(events: readonly LearningEvent[], every: number): QuizSlot[] {
  const done = new Set<string>();
  const slots: QuizSlot[] = [];
  for (const event of events) {
    const ref = event.kind === "lesson.completed" && event.ref !== undefined ? parseRef(event.ref) : undefined;
    if (ref?.kind !== "lesson" || done.has(ref.id)) continue;
    done.add(ref.id);
    if (done.size % every === 0) slots.push({ opened: new Date(timeOf(event)).toISOString(), after: event.ref! });
  }
  return slots;
}

function weeklySlots(subject: Subject, events: readonly LearningEvent[], now: number): QuizSlot[] {
  const first = events.find((event) => event.kind === "session.start");
  if (first === undefined) return [];
  const { timezone, weekStart } = subject.settings;
  const opens = (week: number) => endOfDay(isoDate(week - 1), timezone);
  const slots: QuizSlot[] = [];
  const thisWeek = weekOf(localDay(now, timezone), weekStart);
  for (let week = weekOf(localDay(timeOf(first), timezone), weekStart) + 7; week <= thisWeek; week += 7) {
    slots.push({ opened: new Date(opens(week)).toISOString() });
  }
  return slots;
}

export function quizSlots(subject: Subject, events: readonly LearningEvent[], now: Date): QuizSlot[] {
  const { enabled, quizFrequency } = subject.settings.assessments;
  if (!enabled || quizFrequency === "onDemand") return [];
  const at = now.getTime();
  const past = events.filter((event) => timeOf(event) <= at).sort((a, b) => timeOf(a) - timeOf(b));
  return quizFrequency === "weekly" ? weeklySlots(subject, past, at) : lessonSlots(past, quizFrequency.every);
}

export function dueQuiz(subject: Subject, events: readonly LearningEvent[], now: Date): QuizSlot | undefined {
  const slot = quizSlots(subject, events, now).at(-1);
  if (slot === undefined) return undefined;
  const opened = Date.parse(slot.opened);
  const taken = events.some((event) => isQuizTaken(event) && timeOf(event) >= opened);
  return taken ? undefined : slot;
}
