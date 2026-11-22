import { isoDate, localDay, parseDay, readActivity, sessionsIn, type Streak } from "./activity.ts";
import { InvalidLearningHomeError, SubjectNotFoundError } from "./errors.ts";
import { scanEvents } from "./event-store.ts";
import type { outcomes } from "./events.ts";
import type { ValidationIssue } from "./issues.ts";
import type { LearningHome } from "./load.ts";

export type AttemptCounts = Record<(typeof outcomes)[number], number> & { total: number };

export interface Stats {
  subjects: string[];
  from: string | null;
  to: string;
  timezone: string;
  sessions: number;
  durationMs: number;
  attempts: AttemptCounts;
  accuracy: number | null;
  activityDays: number;
  streak: Streak;
}

export interface StatsOptions {
  subject?: string;
  from?: string;
  to?: string;
  now?: Date;
}

export async function readStats(home: LearningHome, options: StatsOptions = {}): Promise<Stats> {
  const { subject, ...range } = options;
  if (subject !== undefined && !home.subjects.includes(subject)) {
    throw new SubjectNotFoundError(`No subject "${subject}" in ${home.root}. Subjects: ${home.subjects.join(", ") || "none"}`);
  }
  const subjects = subject === undefined ? home.subjects : [subject];
  const { timezone } = home.config;
  const activity = await readActivity({ ...home, subjects }, range);
  const to = parseDay(activity.today);
  const from = range.from === undefined ? -Infinity : parseDay(range.from);
  if (from > to) throw new RangeError(`The range starts on ${range.from}, after it ends on ${activity.today}`);
  const inRange = (day: number) => day >= from && day <= to;

  const issues: ValidationIssue[] = [];
  const attempts: AttemptCounts = { total: 0, correct: 0, wrong: 0, skipped: 0 };
  let sessions = 0;
  let durationMs = 0;
  for (const id of subjects) {
    const scan = await scanEvents(home.root, id);
    issues.push(...scan.issues);
    for (const session of sessionsIn(scan.lines, timezone).filter((s) => inRange(s.day))) {
      sessions++;
      durationMs += session.ms;
    }
    for (const { event } of scan.lines) {
      if (event.kind !== "attempt" || !event.outcome || !inRange(localDay(Date.parse(event.ts), timezone))) continue;
      attempts.total++;
      attempts[event.outcome]++;
    }
  }
  if (issues.length > 0) throw new InvalidLearningHomeError(issues);

  return {
    subjects: [...subjects].sort(),
    from: range.from ?? null,
    to: isoDate(to),
    timezone,
    sessions,
    durationMs,
    attempts,
    accuracy: attempts.total === 0 ? null : attempts.correct / attempts.total,
    activityDays: activity.days.length,
    streak: activity.streak,
  };
}
