import type { ScheduledItem, Subject } from "../api.ts";
import { count, dayOf } from "../home/model.ts";
import { curriculumView, type LessonName, lessonName, subjectPath } from "./model.ts";

type Item = Subject["items"][number];

export interface Term {
  id: string;
  word: string;
  audio?: string;
  when: string;
  due: boolean;
}

export interface TermGroup {
  lesson?: string;
  name: LessonName;
  href?: string;
  terms: Term[];
}

export interface Glossary {
  groups: TermGroup[];
  items: number;
  lessons: number;
}

function wordOf(item: Item): string {
  switch (item.type) {
    case "flashcard":
      return item.front;
    case "routine":
      return item.name;
    default:
      return item.answer;
  }
}

function whenOf(dueOn: string | null, today: string): { when: string; due: boolean } {
  const days = dueOn === null ? 0 : dayOf(dueOn) - dayOf(today);
  if (days <= 0) return { when: "due today", due: true };
  return { when: days === 1 ? "tomorrow" : `in ${days} days`, due: false };
}

function termOf({ item, dueOn }: ScheduledItem, subject: Subject, today: string): Term {
  const audio = item.type === "timed-audio" ? item.audio : undefined;
  return {
    id: item.id,
    word: wordOf(item),
    ...(audio !== undefined && { audio: subjectPath(subject.id) + `/${audio}` }),
    ...whenOf(dueOn, today),
  };
}

export function glossaryOf(subject: Subject, scheduled: readonly ScheduledItem[], today: string): Glossary {
  const view = curriculumView(subject, []);
  const order = [...view.units.flatMap((unit) => unit.milestones.flatMap((milestone) => milestone.lessons)), ...view.other].map(
    (lesson) => lesson.id,
  );
  const rank = (lesson: string) => (order.includes(lesson) ? order.indexOf(lesson) : order.length);
  const byLesson = new Map<string | undefined, Term[]>();
  for (const entry of scheduled) {
    const lesson = entry.item.unlockedBy;
    byLesson.set(lesson, [...(byLesson.get(lesson) ?? []), termOf(entry, subject, today)]);
  }
  const groups = [...byLesson]
    .map(([lesson, terms]): TermGroup => {
      if (lesson === undefined) return { name: { title: "From the start" }, terms };
      return {
        lesson,
        name: lessonName(lesson),
        ...(subject.lessons.includes(lesson) && { href: subjectPath(subject.id, "lessons", `${lesson}.html`) }),
        terms,
      };
    })
    .sort((a, b) => (a.lesson === undefined ? -1 : b.lesson === undefined ? 1 : rank(a.lesson) - rank(b.lesson)));
  return { groups, items: scheduled.length, lessons: groups.filter((group) => group.lesson !== undefined).length };
}

export function glossaryDetail(subject: Subject, completed: readonly string[]): string {
  const unlocked = subject.items.filter(
    (item) =>
      item.type !== "routine" && !item.retired && (item.unlockedBy === undefined || completed.includes(item.unlockedBy)),
  );
  const audio = unlocked.some((item) => item.type === "timed-audio" && item.audio !== undefined);
  return [count(unlocked.length, "item"), ...(audio ? ["hear each one"] : []), "built in"].join(" · ");
}
