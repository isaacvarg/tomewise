import { isoDate, localDay, weekOf } from "./activity.ts";
import { isQuizDrillId } from "./drills.ts";
import { endOfDay } from "./due.ts";
import { type LearningEvent, parseRef } from "./events.ts";
import type { Subject } from "./subject.ts";

export interface QuizSlot {
  opened: string;
  after?: string;
  quiz?: string;
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

interface Written {
  id: string;
  ready: number;
  taken: number[];
}

function writtenQuizzes(subject: Subject, events: readonly LearningEvent[]): Written[] {
  const completedAt = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "lesson.completed" && event.ref !== undefined && !completedAt.has(event.ref)) completedAt.set(event.ref, timeOf(event));
  }
  return Object.entries(subject.quizAfter)
    .flatMap(([id, after]) => {
      const ready = completedAt.get(after);
      if (ready === undefined) return [];
      const taken = events.filter((event) => isQuizTaken(event) && event.ref === `quiz:${id}`).map(timeOf);
      return [{ id, ready, taken }];
    })
    .sort((a, b) => a.ready - b.ready || a.id.localeCompare(b.id));
}

function fillSlots(slots: readonly QuizSlot[], written: readonly Written[]): QuizSlot[] {
  return slots.map((slot) => {
    const opened = Date.parse(slot.opened);
    const quiz = written.find((quiz) => quiz.ready <= opened && !quiz.taken.some((at) => at < opened));
    return quiz ? { ...slot, quiz: quiz.id } : slot;
  });
}

export function quizSlots(subject: Subject, events: readonly LearningEvent[], now: Date): QuizSlot[] {
  const { enabled, quizFrequency } = subject.settings.assessments;
  if (!enabled || quizFrequency === "onDemand") return [];
  const at = now.getTime();
  const past = events.filter((event) => timeOf(event) <= at).sort((a, b) => timeOf(a) - timeOf(b));
  const slots = quizFrequency === "weekly" ? weeklySlots(subject, past, at) : lessonSlots(past, quizFrequency.every);
  return fillSlots(slots, writtenQuizzes(subject, past));
}

export function dueQuiz(subject: Subject, events: readonly LearningEvent[], now: Date): QuizSlot | undefined {
  const slot = quizSlots(subject, events, now).at(-1);
  if (slot === undefined) return undefined;
  const opened = Date.parse(slot.opened);
  const taken = events.some((event) => isQuizTaken(event) && timeOf(event) >= opened);
  return taken ? undefined : slot;
}
