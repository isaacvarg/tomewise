import { DefaultScheduler, type Grade } from "ts-fsrs";
import { isoDate, localDay as dayNumber } from "./activity.ts";
import { readEvents } from "./event-store.ts";
import { parseRef, type LearningEvent } from "./events.ts";
import type { Item } from "./items.ts";
import { loadSubject, type LearningHome } from "./load.ts";

export interface DueItem {
  item: Item;
  due: string | null;
}

export interface ScheduledItem extends DueItem {
  dueOn: string | null;
}

let scheduler: ReturnType<typeof DefaultScheduler<"FSRS-7">> | undefined;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function offsetAt(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return local - Math.floor(instant / 1000) * 1000;
}

function localDay(on: Date | string, timezone: string): [number, number, number] {
  if (typeof on === "string") {
    const match = DAY.exec(on);
    if (!match) throw new RangeError(`Not a date: ${on}; use YYYY-MM-DD`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  if (Number.isNaN(on.getTime())) throw new RangeError("Not a date: Invalid Date");
  const shifted = new Date(on.getTime() + offsetAt(on.getTime(), timezone));
  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()];
}

function endOfDay(on: Date | string, timezone: string): number {
  const [year, month, day] = localDay(on, timezone);
  const midnight = Date.UTC(year, month - 1, day + 1);
  let instant = midnight - offsetAt(midnight, timezone);
  instant = midnight - offsetAt(instant, timezone);
  return instant;
}

function uniqueById(events: LearningEvent[]): LearningEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => !seen.has(event.id) && seen.add(event.id));
}

function refId(event: LearningEvent, kind: string): string | undefined {
  const ref = event.ref === undefined ? undefined : parseRef(event.ref);
  return ref?.kind === kind ? ref.id : undefined;
}

type Card = ReturnType<Awaited<NonNullable<typeof scheduler>>["forward"]>[number]["card"];

interface Replayed {
  item: Item;
  at: number | null;
  card: Card | undefined;
  attempts: LearningEvent[];
}


async function replay(home: LearningHome, subjectId: string, cutoff: (timezone: string) => number) {
  const subject = await loadSubject(home, subjectId);
  const timezone = subject.settings.timezone;
  const until = cutoff(timezone);
  const events = uniqueById(await readEvents(home, subjectId, { to: new Date(until) }));
  const fsrs = await (scheduler ??= DefaultScheduler());

  const completed = new Map<string, number>();
  const attempts = new Map<string, LearningEvent[]>();
  for (const event of events) {
    if (event.kind === "lesson.completed") {
      const lesson = refId(event, "lesson");
      if (lesson !== undefined && !completed.has(lesson)) completed.set(lesson, Date.parse(event.ts));
    } else if (event.kind === "attempt" && event.grade !== undefined) {
      const item = refId(event, "item");
      if (item !== undefined) attempts.set(item, [...(attempts.get(item) ?? []), event]);
    }
  }

  const scheduled: Replayed[] = [];
  for (const item of subject.items) {
    if (item.type === "routine" || item.retired) continue;
    const unlockedAt = item.unlockedBy === undefined ? null : completed.get(item.unlockedBy);
    if (unlockedAt === undefined) continue;
    const history = attempts.get(item.id) ?? [];
    if (history.length === 0) {
      scheduled.push({ item, at: unlockedAt, card: undefined, attempts: history });
      continue;
    }
    const replayed = fsrs.forward({
      history: history.map((attempt) => ({ rating: attempt.grade as Grade, reviewTime: new Date(attempt.ts) })),
    });
    const card = replayed.at(-1)!.card;
    scheduled.push({ item, at: card.dueAt.getTime(), card, attempts: history });
  }
  return { subject, scheduled, cutoff: until, timezone, fsrs };
}

const schedule = (home: LearningHome, subjectId: string, on: Date | string) =>
  replay(home, subjectId, (timezone) => endOfDay(on, timezone));

const isoOf = (at: number | null) => (at === null ? null : new Date(at).toISOString());

export async function nextDue(home: LearningHome, subjectId: string, on: Date | string): Promise<ScheduledItem[]> {
  const { scheduled, timezone } = await schedule(home, subjectId, on);
  return scheduled.map(({ item, at }) => ({
    item,
    due: isoOf(at),
    dueOn: at === null ? null : isoDate(dayNumber(at, timezone)),
  }));
}

export async function dueItems(home: LearningHome, subjectId: string, on: Date | string): Promise<DueItem[]> {
  const { scheduled, cutoff } = await schedule(home, subjectId, on);
  return scheduled
    .filter(({ at }) => at === null || at < cutoff)
    .sort((a, b) => (a.at ?? Number.MIN_SAFE_INTEGER) - (b.at ?? Number.MIN_SAFE_INTEGER))
    .map(({ item, at }) => ({ item, due: isoOf(at) }));
}

const DAY_MS = 86_400_000;
const MISSED_WITHIN_DAYS = 30;
const MISSED_SHARE = 0.25;

export async function quizItems(home: LearningHome, subjectId: string, now: Date): Promise<Item[]> {
  if (Number.isNaN(now.getTime())) throw new RangeError("Not a date: Invalid Date");
  const at = now.getTime();
  const { subject, scheduled, fsrs } = await replay(home, subjectId, () => at);
  const length = subject.settings.assessments.quizLength;

  const since = at - MISSED_WITHIN_DAYS * DAY_MS;
  const lastMissed = (entry: Replayed) =>
    Math.max(-Infinity, ...entry.attempts.filter((attempt) => attempt.grade === 1).map((attempt) => Date.parse(attempt.ts)));
  const missed = scheduled
    .map((entry) => ({ entry, missedAt: lastMissed(entry) }))
    .filter(({ missedAt }) => missedAt >= since)
    .sort((a, b) => b.missedAt - a.missedAt)
    .slice(0, Math.round(length * MISSED_SHARE))
    .map(({ entry }) => entry);

  const retrievability = ({ card }: Replayed) =>
    card ? fsrs.model.forgettingCurve(card, Math.max(0, (at - card.lastReviewAt!.getTime()) / DAY_MS)) : 0;
  const chosen = new Set(missed);
  const weakest = scheduled
    .filter((entry) => !chosen.has(entry))
    .map((entry) => ({ entry, retrievability: retrievability(entry) }))
    .sort((a, b) => a.retrievability - b.retrievability)
    .slice(0, length - missed.length)
    .map(({ entry }) => entry);

  return [...missed, ...weakest].map(({ item }) => item);
}
