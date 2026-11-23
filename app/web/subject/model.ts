import type { Activity, Subject } from "../api.ts";
import { dateOf, dayOf, type HeatCell, heatmapCells, WEEKDAYS, type WeekStart, weekdayOf, weekStartOf } from "../home/model.ts";

type Item = Subject["items"][number];
type Drill = Subject["drills"][number];
type Goal = Subject["goals"][number];
type Milestone = NonNullable<Subject["curriculum"]>["units"][number]["milestones"][number];

export const TABS = [
  { view: "overview", label: "Overview" },
  { view: "curriculum", label: "Curriculum" },
  { view: "drills", label: "Drills" },
  { view: "reference", label: "Reference" },
  { view: "stats", label: "Stats" },
] as const;

export type View = (typeof TABS)[number]["view"];

export function viewOf(tab: string | undefined): View | undefined {
  if (tab === undefined) return "overview";
  return TABS.find((candidate) => candidate.view === tab && tab !== "overview")?.view;
}

export const subjectPath = (subject: string, ...rest: string[]) => `/s/${[subject, ...rest].map(encodeURIComponent).join("/")}`;

export const tabPath = (subject: string, view: View) => (view === "overview" ? subjectPath(subject) : subjectPath(subject, view));

const spaced = (id: string) => id.replaceAll("-", " ");
const capitalised = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

export function subjectHeatmap(activity: Activity, weekStart: WeekStart): HeatCell[] {
  const most = Math.max(1, ...activity.days.map((day) => day.minutes));
  return heatmapCells(activity, weekStart, (day) => Math.max(1, Math.ceil((4 * day.minutes) / most)));
}

export interface GoalDay {
  letter: string;
  state: "met" | "part" | "none";
  today: boolean;
}

export interface GoalProgress {
  goal: Goal;
  minutes: number;
  toGo: number;
  week?: GoalDay[];
}

export function goalProgress(subject: Subject, activity: Activity): GoalProgress | undefined {
  const goal = [...subject.goals].sort((a, b) => (a.per === b.per ? 0 : a.per === "day" ? -1 : 1))[0];
  if (!goal) return undefined;
  const results = activity.goals.filter((result) => result.subject === subject.id && result.goal.id === goal.id);
  const current = results.find((result) => result.from <= activity.today && activity.today <= result.to);
  const minutes = Math.floor(current?.minutes ?? 0);
  const progress = { goal, minutes, toGo: Math.max(0, Math.ceil(goal.minutes - minutes)) };
  if (goal.per === "week") return progress;
  const today = dayOf(activity.today);
  const first = weekStartOf(today, subject.settings.weekStart);
  const week = Array.from({ length: 7 }, (_, index): GoalDay => {
    const date = dateOf(first + index);
    const result = results.find((candidate) => candidate.from === date);
    const state = result?.met ? "met" : result && result.minutes > 0 ? "part" : "none";
    return { letter: WEEKDAYS[weekdayOf(first + index)]![0]!.toUpperCase(), state, today: date === activity.today };
  });
  return { ...progress, week };
}

export function weekdayName(index: number, weekStart: WeekStart): string {
  return capitalised(WEEKDAYS[(WEEKDAYS.indexOf(weekStart) + index) % 7]!);
}

export interface LessonName {
  number?: number;
  title: string;
}

export function lessonName(id: string): LessonName {
  const numbered = /^(\d+)-(.+)$/.exec(id);
  if (!numbered) return { title: capitalised(spaced(id)) };
  return { number: Number(numbered[1]), title: capitalised(spaced(numbered[2]!)) };
}

export function refName(ref: string): string {
  const [kind, id = ""] = ref.split(/:(.*)/);
  if (kind === "lesson") return lessonName(id).title;
  return capitalised(spaced(id));
}

export interface SheetRow {
  id: string;
  name: string;
  href: string;
}

export const sheetRows = (subject: Subject): SheetRow[] =>
  subject.references.map((id) => ({ id, name: capitalised(spaced(id)), href: subjectPath(subject.id, "reference", `${id}.html`) }));

export interface LessonRow {
  id: string;
  href: string;
  name: LessonName;
  done: boolean;
  items: number;
  later?: string;
}

export interface MilestoneView {
  id: string;
  title: string;
  status: Milestone["status"];
  lessons: LessonRow[];
  exam?: { title: string; href?: string };
}

export interface UnitView {
  title: string;
  milestones: MilestoneView[];
}

export interface CurriculumView {
  units: UnitView[];
  other: LessonRow[];
  done: number;
  total: number;
}

export function curriculumView(subject: Subject, completed: readonly string[]): CurriculumView {
  const done = new Set(completed);
  const itemCount = (lesson: string) => subject.items.filter((item) => item.unlockedBy === lesson && !item.retired).length;
  const row = (id: string, later?: string): LessonRow => ({
    id,
    href: subjectPath(subject.id, "lessons", `${id}.html`),
    name: lessonName(id),
    done: done.has(id),
    items: itemCount(id),
    ...(later !== undefined && { later }),
  });
  const placed = new Set<string>();
  let previous: { unit: number; title: string } | undefined;
  const units = (subject.curriculum?.units ?? []).map((unit, u): UnitView => ({
    title: `Unit ${u + 1} · ${unit.title}`,
    milestones: unit.milestones.map((milestone): MilestoneView => {
      const after = !previous ? "later" : previous.unit === u ? `after ${previous.title}` : `after Unit ${previous.unit + 1}`;
      previous = { unit: u, title: milestone.title };
      const later = milestone.status === "upcoming" ? after : undefined;
      const lessons = milestone.lessons.filter((id) => subject.lessons.includes(id));
      lessons.forEach((id) => placed.add(id));
      return {
        id: milestone.id,
        title: milestone.title,
        status: milestone.status,
        lessons: lessons.map((id) => row(id, later)),
        ...(milestone.exam !== undefined && {
          exam: {
            title: `Exam · ${spaced(milestone.exam)}`,
            ...(subject.exams.includes(milestone.exam) && { href: subjectPath(subject.id, "exams", `${milestone.exam}.html`) }),
          },
        }),
      };
    }),
  }));
  const other = subject.lessons.filter((id) => !placed.has(id)).map((id) => row(id));
  return { units, other, done: subject.lessons.filter((id) => done.has(id)).length, total: subject.lessons.length };
}

const DRILLABLE = new Set<Item["type"]>(["flashcard", "multiple-choice", "typed-answer", "timed-audio"]);

const FORMATS: Partial<Record<Drill["format"], string>> = {
  flashcard: "flashcards",
  "multiple-choice": "pick the answer",
  "typed-answer": "type the answer",
  "timed-audio": "listen and answer",
};

export interface DrillRow {
  id: string;
  name: string;
  detail: string;
  href: string;
  locked?: string;
}

function drillDetail(drill: Drill): string {
  const parts = [drill.count !== undefined ? `${drill.count} items` : drill.select.from === "due" ? "what's due" : "every unlocked item"];
  const format = FORMATS[drill.format];
  if (format) parts.push(format);
  const each = drill.timeLimits?.perItemSeconds;
  if (each !== undefined) parts.push(`${each} s each`);
  const total = drill.timeLimits?.totalSeconds;
  if (total !== undefined) parts.push(`${Math.ceil(total / 60)} min in all`);
  return parts.join(" · ");
}

export function drillRows(subject: Subject, completed: readonly string[]): DrillRow[] {
  const done = new Set(completed);
  return subject.drills
    .filter((drill) => !drill.builtIn)
    .map((drill) => {
      const pool = subject.items.filter(
        (item) =>
          !item.retired &&
          DRILLABLE.has(item.type) &&
          (drill.select.tags.length === 0 || drill.select.tags.some((tag) => item.tags.includes(tag))),
      );
      const row = {
        id: drill.id,
        name: drill.name,
        detail: drillDetail(drill),
        href: `/run?drill=${encodeURIComponent(drill.id)}&subject=${encodeURIComponent(subject.id)}`,
      };
      if (pool.some((item) => item.unlockedBy === undefined || done.has(item.unlockedBy))) return row;
      const next = subject.lessons.find((lesson) => pool.some((item) => item.unlockedBy === lesson));
      if (next === undefined) return { ...row, locked: "No items yet" };
      const name = lessonName(next);
      return { ...row, locked: name.number === undefined ? `After ${name.title}` : `After lesson ${name.number}` };
    });
}
