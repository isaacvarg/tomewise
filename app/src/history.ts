import { isoDate, type LearningEvent, localDay } from "@tomewise/core";

interface Totals {
  sessions: number;
  minutes: number;
  attempts: number;
}

const noTotals = (): Totals => ({ sessions: 0, minutes: 0, attempts: 0 });

function count(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

function describe({ sessions, minutes, attempts }: Totals): string {
  return `${count(sessions, "session")}, ${minutes} min, ${count(attempts, "attempt")}`;
}

function totalsOf(events: LearningEvent[]): Totals {
  let durationMs = 0;
  const totals = noTotals();
  for (const event of events) {
    if (event.kind === "session.end") {
      totals.sessions++;
      durationMs += event.duration ?? 0;
    } else if (event.kind === "attempt") {
      totals.attempts++;
    }
  }
  return { ...totals, minutes: Math.round(durationMs / 60_000) };
}

export function historyMessage(events: LearningEvent[], timezone: string): string {
  const earliest = Math.min(...events.map((event) => Date.parse(event.ts)));
  const date = isoDate(localDay(earliest, timezone));
  const bySubject = [...Map.groupBy(events, (event) => event.subject)]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([subject, inSubject]) => ({ subject, totals: totalsOf(inSubject) }));
  const lines = bySubject.map(({ subject, totals }) => `${subject} ${describe(totals)}`);
  if (lines.length === 1) return `chore(history): ${date} · ${lines[0]}`;
  const total = bySubject.reduce((sum, { totals }) => ({
    sessions: sum.sessions + totals.sessions,
    minutes: sum.minutes + totals.minutes,
    attempts: sum.attempts + totals.attempts,
  }), noTotals());
  return [`chore(history): ${date} · ${count(lines.length, "subject")}, ${describe(total)}`, "", ...lines].join("\n");
}
