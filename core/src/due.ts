import { DefaultScheduler, type Grade } from "ts-fsrs";
import { readEvents } from "./event-store.ts";
import { parseRef, type LearningEvent } from "./events.ts";
import type { Item } from "./items.ts";
import { loadSubject, type LearningHome } from "./load.ts";

export interface DueItem {
  item: Item;
  due: string | null;
}

let scheduler: ReturnType<typeof DefaultScheduler> | undefined;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function offsetAt(instant: number, timezone: string): number {
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

export async function dueItems(home: LearningHome, subjectId: string, on: Date | string): Promise<DueItem[]> {
  const subject = await loadSubject(home, subjectId);
  const cutoff = endOfDay(on, subject.settings.timezone);
  const events = uniqueById(await readEvents(home, subjectId, { to: new Date(cutoff) }));
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

  const due: { item: Item; at: number | null }[] = [];
  for (const item of subject.items) {
    if (item.type === "routine" || item.retired) continue;
    const unlockedAt = item.unlockedBy === undefined ? null : completed.get(item.unlockedBy);
    if (unlockedAt === undefined) continue;
    const history = attempts.get(item.id) ?? [];
    if (history.length === 0) {
      due.push({ item, at: unlockedAt });
      continue;
    }
    const replayed = fsrs.forward({
      history: history.map((attempt) => ({ rating: attempt.grade as Grade, reviewTime: new Date(attempt.ts) })),
    });
    const at = replayed.at(-1)!.card.dueAt.getTime();
    if (at < cutoff) due.push({ item, at });
  }

  return due
    .sort((a, b) => (a.at ?? Number.MIN_SAFE_INTEGER) - (b.at ?? Number.MIN_SAFE_INTEGER))
    .map(({ item, at }) => ({ item, due: at === null ? null : new Date(at).toISOString() }));
}
