import { offsetAt } from "./due.ts";
import { QueryError } from "./errors.ts";
import { readEvents } from "./event-store.ts";
import { type EventKind, eventKinds, type LearningEvent } from "./events.ts";
import { loadSubject, type LearningHome } from "./load.ts";
import type { Subject } from "./subject.ts";

export const aggregates = ["count", "mean", "median", "min", "max"] as const;

export type Aggregate = (typeof aggregates)[number];

export const filterFields = ["ref", "outcome", "kind", "grade", "sessionId"] as const;

type FilterField = (typeof filterFields)[number];

export interface QueryOptions {
  field: string;
  agg: Aggregate;
  where?: Partial<Record<FilterField, string>>;
  from?: string;
  to?: string;
}

export interface QueryResult {
  subject: string;
  kind: EventKind;
  field: string;
  agg: Aggregate;
  unit: string | null;
  value: number | null;
  count: number;
  where: Partial<Record<FilterField, string>>;
  from: string | null;
  to: string | null;
}

type FieldSchema = NonNullable<Subject["payloadSchemas"][number]["kinds"][EventKind]>["properties"][string];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATA_PREFIX = "data.";

function startOfDay(date: string, timezone: string, flag: string, plusDays = 0): number {
  const match = DAY.exec(date);
  const [year, month, day] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [];
  const valid = match && new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10) === date;
  if (!valid) throw new QueryError(`${flag} must be a date, YYYY-MM-DD, not "${date}"`);
  const midnight = Date.UTC(year!, month! - 1, day! + plusDays);
  const instant = midnight - offsetAt(midnight, timezone);
  return midnight - offsetAt(instant, timezone);
}

function knownFields(subject: Subject, kind: EventKind): Map<string, FieldSchema> {
  const fields = new Map<string, FieldSchema>();
  for (const version of subject.payloadSchemas) {
    for (const [name, field] of Object.entries(version.kinds[kind]?.properties ?? {})) fields.set(name, field);
  }
  return fields;
}

function isNumeric(field: FieldSchema): boolean {
  const scalar = "items" in field ? field.items : field;
  return "enum" in scalar ? scalar.enum.every((value) => typeof value === "number") : scalar.type === "number" || scalar.type === "integer";
}

function unitOf(field: FieldSchema): string | null {
  return ("items" in field ? field.items.unit : field.unit) ?? null;
}

function fieldIn(subject: Subject, event: LearningEvent, kind: EventKind, name: string): boolean {
  return subject.payloadSchemas[event.schemaVersion - 1]?.kinds[kind]?.properties[name] !== undefined;
}

function matches(event: LearningEvent, where: Partial<Record<FilterField, string>>): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    const actual = event[key as FilterField];
    return actual !== undefined && String(actual) === wanted;
  });
}

function aggregate(agg: Aggregate, values: number[]): number | null {
  if (agg === "count") return values.length;
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  switch (agg) {
    case "mean":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "median": {
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    case "min":
      return sorted[0]!;
    case "max":
      return sorted.at(-1)!;
  }
}

export async function queryPayload(home: LearningHome, subjectId: string, options: QueryOptions): Promise<QueryResult> {
  const subject = await loadSubject(home, subjectId);
  const where = { ...options.where };
  for (const key of Object.keys(where)) {
    if (!filterFields.includes(key as FilterField)) {
      throw new QueryError(`Cannot filter on "${key}"; use one of ${filterFields.join(", ")}`);
    }
  }
  const kind = (where.kind ?? "attempt") as EventKind;
  if (!eventKinds.includes(kind)) throw new QueryError(`Unknown kind "${kind}"; use one of ${eventKinds.join(", ")}`);
  if (!aggregates.includes(options.agg)) {
    throw new QueryError(`Unknown aggregate "${options.agg}"; use one of ${aggregates.join(", ")}`);
  }

  const name = options.field.startsWith(DATA_PREFIX) ? options.field.slice(DATA_PREFIX.length) : options.field;
  const fields = knownFields(subject, kind);
  const field = fields.get(name);
  if (!field) {
    const known = fields.size > 0 ? `known fields: ${[...fields.keys()].join(", ")}` : "its payload schema has no fields";
    throw new QueryError(`No field "${name}" in ${subjectId} ${kind} payloads; ${known}`);
  }
  if (options.agg !== "count" && !isNumeric(field)) {
    throw new QueryError(`"${name}" is not a number; only count works on it`);
  }

  const { timezone } = subject.settings;
  const from = options.from === undefined ? undefined : new Date(startOfDay(options.from, timezone, "--from"));
  const to = options.to === undefined ? undefined : new Date(startOfDay(options.to, timezone, "--to", 1));
  const events = (await readEvents(home, subjectId, { from, to })).filter(
    (event) => event.kind === kind && matches(event, where) && fieldIn(subject, event, kind, name) && event.data[name] !== undefined,
  );
  const values = events.flatMap((event) => {
    const value = event.data[name];
    return Array.isArray(value) ? value : [value];
  });

  return {
    subject: subjectId,
    kind,
    field: name,
    agg: options.agg,
    unit: unitOf(field),
    value: aggregate(options.agg, values as number[]),
    count: events.length,
    where: options.where ?? {},
    from: options.from ?? null,
    to: options.to ?? null,
  };
}
