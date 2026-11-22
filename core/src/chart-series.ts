import { isoDate, localDay, sessionsOf } from "./activity.ts";
import type { Chart, ChartAggregate } from "./charts.ts";
import { type LearningEvent, parseRef } from "./events.ts";
import { knownFields, unitOf } from "./payload.ts";
import { aggregate } from "./query.ts";
import type { Subject } from "./subject.ts";

export interface ChartPoint {
  date: string;
  value: number | null;
}

export interface ChartSeries {
  id: string;
  title: string;
  kind: Chart["kind"];
  measure: Chart["measure"];
  aggregate: ChartAggregate | null;
  unit: string | null;
  points: ChartPoint[];
}

export interface ChartOptions {
  now?: Date;
}

const MINUTE_MS = 60_000;

function keptEvents(subject: Subject, chart: Chart, events: readonly LearningEvent[]): LearningEvent[] {
  const filter = chart.items;
  if (!filter) return [...events];
  if (chart.measure === "minutes" && !("drill" in filter)) {
    throw new RangeError(`Chart "${chart.id}" filters minutes by item; minutes come from whole sessions, so filter them by drill`);
  }
  if ("drill" in filter) {
    const ref = `drill:${filter.drill}`;
    const sessions = new Set(events.filter((e) => e.kind === "session.start" && e.ref === ref).map((e) => e.id));
    return events.filter((event) => event.sessionId !== undefined && sessions.has(event.sessionId));
  }
  const items = new Set(
    subject.items.filter((item) => ("tag" in filter ? item.tags.includes(filter.tag) : item.type === filter.type)).map((item) => item.id),
  );
  return events.filter((event) => {
    const ref = event.ref === undefined ? undefined : parseRef(event.ref);
    return ref?.kind === "item" && items.has(ref.id);
  });
}

function payloadValues(subject: Subject, event: LearningEvent, field: string): number[] {
  if (subject.payloadSchemas[event.schemaVersion - 1]?.kinds.attempt?.properties[field] === undefined) return [];
  const value = event.data[field];
  return (Array.isArray(value) ? value : [value]).filter((v): v is number => typeof v === "number");
}

function samplesByDay(subject: Subject, chart: Chart, events: LearningEvent[]): Map<number, number[]> {
  const { timezone } = subject.settings;
  const samples = new Map<number, number[]>();
  const add = (day: number, ...values: number[]) => samples.set(day, [...(samples.get(day) ?? []), ...values]);
  if (chart.measure === "minutes") {
    for (const session of sessionsOf(events, timezone)) add(session.day, session.ms / MINUTE_MS);
    return samples;
  }
  const attempts = events.filter((event) => event.kind === "attempt");
  const dayOf = (event: LearningEvent) => localDay(Date.parse(event.ts), timezone);
  switch (chart.measure) {
    case "payload":
      for (const event of attempts) add(dayOf(event), ...payloadValues(subject, event, chart.field));
      break;
    case "accuracy":
      for (const event of attempts) add(dayOf(event), event.outcome === "correct" ? 1 : 0);
      break;
    case "attempts":
      for (const inSession of Map.groupBy(attempts, (event) => event.sessionId).values()) {
        add(Math.min(...inSession.map(dayOf)), inSession.length);
      }
      break;
  }
  return samples;
}

function unitFor(subject: Subject, chart: Chart): string | null {
  switch (chart.measure) {
    case "payload": {
      const field = knownFields(subject.payloadSchemas, "attempt").get(chart.field);
      return field ? unitOf(field) : null;
    }
    case "accuracy":
      return "ratio";
    case "attempts":
      return null;
    case "minutes":
      return "min";
  }
}

export function chartSeries(subject: Subject, chart: Chart, events: readonly LearningEvent[], options: ChartOptions = {}): ChartSeries {
  const today = localDay((options.now ?? new Date()).getTime(), subject.settings.timezone);
  const samples = samplesByDay(subject, chart, keptEvents(subject, chart, events));
  const agg = "aggregate" in chart ? chart.aggregate : null;
  const countsTotal = agg === "total" && chart.measure !== "payload";
  const valueOf = (values: number[]): number | null => {
    if (values.length === 0) return countsTotal ? 0 : null;
    if (agg === "total") return values.reduce((sum, value) => sum + value, 0);
    return aggregate(agg ?? "mean", values);
  };
  const points: ChartPoint[] = [];
  for (let day = today - chart.days + 1; day <= today; day++) {
    points.push({ date: isoDate(day), value: valueOf(samples.get(day) ?? []) });
  }
  return { id: chart.id, title: chart.title, kind: chart.kind, measure: chart.measure, aggregate: agg, unit: unitFor(subject, chart), points };
}
