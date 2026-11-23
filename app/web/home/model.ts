import type { Activity, DueItem, Subject } from "../api.ts";

type ActivityDay = Activity["days"][number];

export type WeekStart = Subject["settings"]["weekStart"];

const DAY_MS = 86_400_000;
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export const HEATMAP_WEEKS = 52;
export const NARROW_WEEKS = 18;
export const SECONDS_PER_ITEM = 40;

export const dayOf = (date: string) => Date.parse(date) / DAY_MS;
export const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const weekdayOf = (day: number) => (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
export const weekStartOf = (day: number, weekStart: WeekStart) => day - ((weekdayOf(day) - WEEKDAYS.indexOf(weekStart) + 7) % 7);

export interface HeatCell {
  date: string;
  level: number;
  today: boolean;
  future: boolean;
  old: boolean;
}

export const bySubjectsPractised =
  (subjectCount: number) =>
  ({ subjects }: ActivityDay): number =>
    Math.min(4, Math.ceil((4 * subjects.length) / Math.max(subjectCount, subjects.length)));

export function heatmapCells(activity: Activity, weekStart: WeekStart, levelOf: (day: ActivityDay) => number): HeatCell[] {
  const today = dayOf(activity.today);
  const first = weekStartOf(today, weekStart) - (HEATMAP_WEEKS - 1) * 7;
  const active = new Map(activity.days.map((day) => [day.date, day]));
  return Array.from({ length: HEATMAP_WEEKS * 7 }, (_, index) => {
    const day = first + index;
    const date = dateOf(day);
    const practised = active.get(date);
    return {
      date,
      level: practised ? levelOf(practised) : 0,
      today: day === today,
      future: day > today,
      old: index < (HEATMAP_WEEKS - NARROW_WEEKS) * 7,
    };
  });
}

export function weekdayLetters(weekStart: WeekStart): string[] {
  const start = WEEKDAYS.indexOf(weekStart);
  return WEEKDAYS.map((_, index) => (index % 2 === 0 ? WEEKDAYS[(start + index) % 7]![0]!.toUpperCase() : ""));
}

export function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.parse(date)),
  );
}

export function bySubjectName(a: Subject, b: Subject): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function inSavedOrder(subjects: readonly Subject[], order: readonly string[]): Subject[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const place = (subject: Subject) => rank.get(subject.id) ?? order.length;
  return [...subjects].sort((a, b) => place(a) - place(b) || bySubjectName(a, b));
}

export interface DueRow {
  subject: Subject;
  items: number;
  minutes: number;
}

export interface DueToday {
  rows: DueRow[];
  items: number;
  minutes: number;
}

export const minutesFor = (items: number) => Math.ceil((items * SECONDS_PER_ITEM) / 60);

export function dueToday(subjects: { subject: Subject; due: DueItem[] }[]): DueToday {
  const rows = subjects
    .map(({ subject, due }) => ({ subject, items: due.length }))
    .filter((row) => row.items > 0)
    .map((row) => ({ ...row, minutes: minutesFor(row.items) }));
  return {
    rows,
    items: rows.reduce((sum, row) => sum + row.items, 0),
    minutes: rows.reduce((sum, row) => sum + row.minutes, 0),
  };
}

export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
