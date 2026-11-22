import type { z } from "zod";
import { InvalidLearningHomeError } from "./errors.ts";
import { type EventLine, scanEvents } from "./event-store.ts";
import { issuesFrom, type ValidationIssue } from "./issues.ts";
import { loadSubject, type LearningHome } from "./load.ts";
import { type Goal, ruleChanges, type StreakRules, weekdays } from "./schemas.ts";

export interface ActivityDay {
  date: string;
  subjects: string[];
}

export interface GoalResult {
  subject: string;
  goal: Goal;
  from: string;
  to: string;
  minutes: number;
  met: boolean;
}

export interface Streak {
  days: number;
  restDaysLeft: number;
}

export interface Activity {
  today: string;
  days: ActivityDay[];
  streak: Streak;
  goals: GoalResult[];
}

export interface ActivityOptions {
  now?: Date;
  from?: string;
  to?: string;
}

const DAY_MS = 86_400_000;

function localDay(time: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(time);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY_MS;
}

function isoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function parseDay(date: string): number {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date) : NaN;
  if (Number.isNaN(time) || isoDate(time / DAY_MS) !== date) throw new RangeError(`Not a date: ${date}; use YYYY-MM-DD`);
  return time / DAY_MS;
}

function weekOf(day: number, weekStart: (typeof weekdays)[number]): number {
  const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
  return day - ((weekday - weekdays.indexOf(weekStart) + 7) % 7);
}

interface Session {
  day: number;
  ms: number;
}

function sessionsIn(lines: EventLine[], timezone: string): Session[] {
  const events = lines.map((line) => line.event);
  const bySession = Map.groupBy(events, (event) => event.sessionId);
  return events
    .filter((event) => event.kind === "session.start")
    .map((start) => {
      const startTime = Date.parse(start.ts);
      const inSession = bySession.get(start.id) ?? [];
      const end = inSession.find((event) => event.kind === "session.end");
      const last = Math.max(...inSession.map((event) => Date.parse(event.ts)));
      return { day: localDay(startTime, timezone), ms: end?.duration ?? last - startTime };
    });
}

class RulesByDay<T> {
  private readonly changes: { day: number; from: T }[] = [];
  private readonly current: T;

  constructor(current: T) {
    this.current = current;
  }

  add(day: number, from: T): void {
    this.changes.push({ day, from });
  }

  at(day: number): T {
    return this.changes.find((change) => change.day > day)?.from ?? this.current;
  }
}

type ChangeKind = keyof typeof ruleChanges;

function changesIn<K extends ChangeKind>(
  lines: EventLine[],
  kind: K,
  issues: ValidationIssue[],
): { time: number; from: z.output<(typeof ruleChanges)[K]>["from"] }[] {
  const changes = [];
  for (const { event, file, line } of lines) {
    if (event.kind !== kind) continue;
    const data = ruleChanges[kind].safeParse(event.data);
    if (data.success) changes.push({ time: Date.parse(event.ts), from: data.data.from });
    else issues.push(...issuesFrom(file, data.error, ["data"]).map((issue) => ({ ...issue, line })));
  }
  return changes;
}

function streakOf(active: Set<number>, today: number, home: LearningHome, rules: RulesByDay<StreakRules>): Streak {
  let days = 0;
  let restDays = new Map<number, number>();
  const first = Math.min(...active);
  for (let day = first; day <= today; day++) {
    if (active.has(day)) {
      days++;
      continue;
    }
    if (day === today || days === 0) continue;
    const week = weekOf(day, home.config.weekStart);
    const used = (restDays.get(week) ?? 0) + 1;
    if (used > rules.at(day).restDaysPerWeek) {
      days = 0;
      restDays = new Map();
    } else {
      restDays.set(week, used);
    }
  }
  const usedThisWeek = restDays.get(weekOf(today, home.config.weekStart)) ?? 0;
  return { days, restDaysLeft: Math.max(0, rules.at(today).restDaysPerWeek - usedThisWeek) };
}

function goalsOf(
  subject: string,
  sessions: Session[],
  today: number,
  home: LearningHome,
  goals: RulesByDay<Goal[]>,
): GoalResult[] {
  const results: GoalResult[] = [];
  const minutesIn = (from: number, to: number) =>
    sessions.filter((s) => s.day >= from && s.day <= to).reduce((sum, s) => sum + s.ms, 0) / 60_000;
  const judge = (per: Goal["per"], from: number, to: number) => {
    const minutes = minutesIn(from, to);
    for (const goal of goals.at(to).filter((g) => g.per === per)) {
      results.push({ subject, goal, from: isoDate(from), to: isoDate(to), minutes, met: minutes >= goal.minutes });
    }
  };
  const first = Math.min(today, ...sessions.map((s) => s.day));
  for (let day = first; day <= today; day++) judge("day", day, day);
  for (let week = weekOf(first, home.config.weekStart); week <= today; week += 7) judge("week", week, week + 6);
  return results.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export async function readActivity(home: LearningHome, options: ActivityOptions = {}): Promise<Activity> {
  const { timezone } = home.config;
  const today = options.to === undefined ? localDay((options.now ?? new Date()).getTime(), timezone) : parseDay(options.to);
  const from = options.from === undefined ? -Infinity : parseDay(options.from);
  const issues: ValidationIssue[] = [];
  const activeSubjects = new Map<number, string[]>();
  const streakChanges: { time: number; from: StreakRules }[] = [];
  const goals: GoalResult[] = [];

  for (const id of home.subjects) {
    const subject = await loadSubject(home, id);
    const scan = await scanEvents(home.root, id);
    issues.push(...scan.issues);
    const sessions = sessionsIn(scan.lines, timezone).filter((s) => s.day <= today);
    for (const { day, ms } of sessions) {
      if (ms < subject.settings.minimumSessionSeconds * 1000) continue;
      const subjects = activeSubjects.get(day) ?? [];
      if (!subjects.includes(id)) subjects.push(id);
      activeSubjects.set(day, subjects);
    }
    streakChanges.push(...changesIn(scan.lines, "streak.changed", issues));
    const goalRules = new RulesByDay(subject.goals);
    for (const change of changesIn(scan.lines, "goal.changed", issues).sort((a, b) => a.time - b.time)) {
      goalRules.add(localDay(change.time, timezone), change.from);
    }
    goals.push(...goalsOf(id, sessions, today, home, goalRules));
  }
  if (issues.length > 0) throw new InvalidLearningHomeError(issues);

  const streakRules = new RulesByDay<StreakRules>(home.config.streak);
  for (const change of streakChanges.sort((a, b) => a.time - b.time)) {
    streakRules.add(localDay(change.time, timezone), change.from);
  }
  const active = new Set(activeSubjects.keys());
  return {
    today: isoDate(today),
    days: [...activeSubjects]
      .filter(([day]) => day >= from)
      .sort(([a], [b]) => a - b)
      .map(([day, subjects]) => ({ date: isoDate(day), subjects: subjects.sort() })),
    streak: streakOf(active, today, home, streakRules),
    goals: goals.filter((goal) => parseDay(goal.to) >= from),
  };
}
