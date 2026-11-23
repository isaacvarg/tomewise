import { z } from "zod";

export const eventKinds = [
  "attempt",
  "session.start",
  "session.end",
  "lesson.completed",
  "explanation.saved",
  "explanation.graded",
  "milestone.status",
  "goal.changed",
  "streak.changed",
] as const;

export type EventKind = (typeof eventKinds)[number];

export const outcomes = ["correct", "wrong", "skipped"] as const;

export const Ulid = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, {
  error: "Use a ULID: 26 characters of Crockford base32, such as \"01KAJ5W3ZQ8V9M2XN4R6T7Y0BC\"",
});

export const refKinds = ["item", "lesson", "drill", "quiz", "exam", "milestone", "event"] as const;

export type RefKind = (typeof refKinds)[number];

const sessionTargets = ["lesson", "drill", "quiz", "exam"] as const;

const refsFor: Record<EventKind, readonly RefKind[]> = {
  attempt: ["item"],
  "session.start": sessionTargets,
  "session.end": sessionTargets,
  "lesson.completed": ["lesson"],
  "explanation.saved": ["lesson", "item"],
  "explanation.graded": ["event"],
  "milestone.status": ["milestone"],
  "goal.changed": [],
  "streak.changed": [],
};

const inSession: readonly EventKind[] = ["attempt", "session.start", "session.end"];

export interface Ref {
  kind: RefKind;
  id: string;
}

export function parseRef(ref: string): Ref | undefined {
  const match = /^([a-z]+):(.+)$/.exec(ref);
  const kind = match?.[1] as RefKind | undefined;
  return match && kind && refKinds.includes(kind) ? { kind, id: match[2]! } : undefined;
}

function article(kind: string): string {
  return /^[aeiou]/.test(kind) ? `An ${kind}` : `A ${kind}`;
}

function orList(words: readonly string[]): string {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}

function refTargets(kinds: readonly RefKind[]): string {
  return article(orList(kinds)).toLowerCase();
}

function refPattern(kinds: readonly RefKind[]): string {
  return `^(?:${kinds.join("|")}):.+$`;
}

const Ref = z
  .string()
  .refine((ref) => parseRef(ref) !== undefined, {
    error: `Use kind:id, such as "item:letter-k"; kinds are ${refKinds.join(", ")}`,
  })
  .meta({ pattern: refPattern(refKinds) });

const Fields = z.strictObject({
  id: Ulid,
  ts: z.iso.datetime({ error: "Use a UTC ISO 8601 timestamp, such as \"2026-11-21T18:04:05.123Z\"" }),
  subject: z.string().min(1),
  kind: z.enum(eventKinds, { error: `Unknown kind; use one of ${eventKinds.join(", ")}` }),
  ref: Ref.optional(),
  sessionId: Ulid.optional(),
  duration: z.int({ error: "Use whole milliseconds" }).min(0).optional(),
  outcome: z.enum(outcomes).optional(),
  grade: z.int().min(1).max(4).optional(),
  score: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .meta({ description: "A session.end's score, as a percentage: what the app scored an exam or quiz session." }),
  schemaVersion: z.int().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

function kindRule(kind: EventKind): z.core.JSONSchema.JSONSchema {
  const allowed = refsFor[kind];
  const required = [
    ...(allowed.length > 0 ? ["ref"] : []),
    ...(inSession.includes(kind) ? ["sessionId"] : []),
    ...(kind === "session.end" ? ["duration"] : []),
    ...(kind === "attempt" ? ["outcome", "grade"] : []),
  ];
  const forbidden = [
    ...(allowed.length === 0 ? ["ref"] : []),
    ...(kind === "attempt" ? [] : ["grade"]),
    ...(kind === "session.end" ? [] : ["score"]),
  ];
  return {
    if: { properties: { kind: { const: kind } }, required: ["kind"] },
    then: {
      ...(allowed.length > 0 && { properties: { ref: { type: "string", pattern: refPattern(allowed) } } }),
      ...(required.length > 0 && { required }),
      ...(forbidden.length > 0 && { not: { anyOf: forbidden.map((name) => ({ required: [name] })) } }),
    },
  };
}

export const EventEnvelope = Fields.superRefine((event, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  const name = article(event.kind);
  const allowed = refsFor[event.kind];
  if (allowed.length === 0) {
    if (event.ref !== undefined) issue("ref", `${name} refers to nothing; remove ref`);
  } else if (event.ref === undefined) {
    issue("ref", `${name} needs a ref to ${refTargets(allowed)}`);
  } else {
    const ref = parseRef(event.ref);
    if (ref && !allowed.includes(ref.kind)) issue("ref", `${name} refers to ${refTargets(allowed)}`);
  }
  if (inSession.includes(event.kind) && event.sessionId === undefined) issue("sessionId", `${name} needs a sessionId`);
  if (event.kind === "session.start" && event.sessionId !== undefined && event.sessionId !== event.id) {
    issue("sessionId", "A session.start's sessionId is its own id");
  }
  if (event.kind === "session.end" && event.duration === undefined) issue("duration", "A session.end needs a duration");
  if (event.kind === "attempt") {
    if (event.outcome === undefined) issue("outcome", "An attempt needs an outcome");
    if (event.grade === undefined) issue("grade", "An attempt needs a grade from 1 to 4");
  } else if (event.grade !== undefined) {
    issue("grade", "Only attempts have a grade");
  }
  if (event.kind !== "session.end" && event.score !== undefined) issue("score", "Only a session.end has a score");
}).meta({ allOf: eventKinds.map(kindRule) });

export type LearningEvent = z.output<typeof EventEnvelope>;
