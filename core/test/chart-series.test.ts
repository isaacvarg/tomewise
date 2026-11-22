import { describe, expect, it } from "vitest";
import { chartSeries, type LearningEvent, loadLearningHome, loadSubject } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const SUBJECT = "morse-code";
const NOW = new Date("2026-11-22T12:00:00.000Z");
let counter = 0;

function nextId(): string {
  counter += 1;
  return `01KAJ${String(counter).padStart(21, "0")}`;
}

const payloadSchemas = [
  { version: 1, kinds: { attempt: { properties: { responseTime: { type: "integer", unit: "ms" } } } } },
  {
    version: 2,
    kinds: {
      attempt: {
        properties: {
          responseTime: { type: "integer", unit: "ms" },
          wpm: { type: "number" },
          splits: { type: "array", items: { type: "integer", unit: "ms" } },
        },
      },
    },
  },
];

async function subjectWith(charts: unknown[], timezone = "Europe/London") {
  const root = await buildHome({
    "tomewise.json": { formatVersion: 1, timezone },
    [`subjects/${SUBJECT}/subject.json`]: { name: "Morse code", payloadSchemas, charts },
    [`subjects/${SUBJECT}/items/letters.json`]: [
      { id: "letter-k", type: "timed-audio", answer: "K", audio: "k.wav", tags: ["letter"] },
      { id: "letter-m", type: "timed-audio", answer: "M", audio: "m.wav", tags: ["letter"] },
      { id: "word-ok", type: "flashcard", front: "OK", back: "--- -.-", tags: ["word"] },
    ],
    [`subjects/${SUBJECT}/drills/listen.json`]: { name: "Listen", select: { from: "unlocked" } },
  });
  return loadSubject(await loadLearningHome(root), SUBJECT);
}

class Log {
  readonly events: LearningEvent[] = [];

  session(ts: string, minutes: number, ref = "lesson:0001-k-and-m"): string {
    const id = nextId();
    const base = { subject: SUBJECT, ref, sessionId: id, schemaVersion: 1, data: {} };
    const end = new Date(Date.parse(ts) + minutes * 60_000).toISOString();
    this.events.push(
      { id, ts, kind: "session.start", ...base },
      { id: nextId(), ts: end, kind: "session.end", duration: minutes * 60_000, ...base },
    );
    return id;
  }

  attempt(sessionId: string, ts: string, extra: Partial<LearningEvent> = {}): void {
    this.events.push({
      id: nextId(),
      ts,
      subject: SUBJECT,
      kind: "attempt",
      ref: "item:letter-k",
      sessionId,
      outcome: "correct",
      grade: 3,
      schemaVersion: 2,
      data: {},
      ...extra,
    });
  }
}

const chart = { id: "c", title: "Chart", kind: "line", days: 3 };

function values(series: { points: { date: string; value: number | null }[] }) {
  return series.points.map((point) => [point.date, point.value]);
}

describe("chart series", () => {
  it("gives each day of the window a payload median, with the field's unit", async () => {
    const subject = await subjectWith([{ ...chart, measure: "payload", field: "responseTime" }]);
    const log = new Log();
    const s = log.session("2026-11-20T09:00:00.000Z", 5);
    log.attempt(s, "2026-11-19T09:01:00.000Z", { data: { responseTime: 999 } });
    for (const responseTime of [300, 100, 200, 400]) log.attempt(s, "2026-11-20T09:01:00.000Z", { data: { responseTime } });
    log.attempt(s, "2026-11-22T09:01:00.000Z", { schemaVersion: 1, data: { responseTime: 250 } });

    const series = chartSeries(subject, subject.charts[0]!, log.events, { now: NOW });

    expect(series).toMatchObject({ id: "c", title: "Chart", kind: "line", measure: "payload", aggregate: "median", unit: "ms" });
    expect(values(series)).toEqual([
      ["2026-11-20", 250],
      ["2026-11-21", null],
      ["2026-11-22", 250],
    ]);
  });

  it("takes the mean or total of a payload field, flattening arrays and skipping events without it", async () => {
    const subject = await subjectWith([
      { ...chart, id: "c1", measure: "payload", field: "splits", aggregate: "mean", days: 1 },
      { ...chart, id: "c2", measure: "payload", field: "wpm", aggregate: "total", days: 1 },
    ]);
    const log = new Log();
    const s = log.session("2026-11-22T09:00:00.000Z", 5);
    log.attempt(s, "2026-11-22T09:01:00.000Z", { data: { splits: [100, 200], wpm: 12 } });
    log.attempt(s, "2026-11-22T09:02:00.000Z", { data: { splits: [600], wpm: 15.5 } });
    log.attempt(s, "2026-11-22T09:03:00.000Z", { schemaVersion: 1, data: { responseTime: 1 } });

    const [mean, total] = subject.charts.map((spec) => chartSeries(subject, spec, log.events, { now: NOW }));

    expect(values(mean!)).toEqual([["2026-11-22", 300]]);
    expect(mean!.unit).toBe("ms");
    expect(values(total!)).toEqual([["2026-11-22", 27.5]]);
    expect(total!.unit).toBeNull();
  });

  it("gives accuracy as the share of attempts each day that were correct", async () => {
    const subject = await subjectWith([{ ...chart, measure: "accuracy", days: 2 }]);
    const log = new Log();
    const s = log.session("2026-11-22T09:00:00.000Z", 5);
    log.attempt(s, "2026-11-22T09:01:00.000Z");
    log.attempt(s, "2026-11-22T09:02:00.000Z", { outcome: "wrong", grade: 1 });
    log.attempt(s, "2026-11-22T09:03:00.000Z");
    log.attempt(s, "2026-11-22T09:04:00.000Z", { outcome: "skipped", grade: 1 });

    const series = chartSeries(subject, subject.charts[0]!, log.events, { now: NOW });

    expect(series).toMatchObject({ measure: "accuracy", unit: "ratio" });
    expect(values(series)).toEqual([
      ["2026-11-21", null],
      ["2026-11-22", 0.5],
    ]);
  });

  it("counts attempts per day, or per session with mean and median", async () => {
    const subject = await subjectWith([
      { ...chart, id: "c3", measure: "attempts", days: 2 },
      { ...chart, id: "c4", measure: "attempts", aggregate: "mean", days: 2 },
      { ...chart, id: "c5", measure: "attempts", aggregate: "median", days: 2 },
    ]);
    const log = new Log();
    for (const count of [1, 2, 6]) {
      const s = log.session("2026-11-22T09:00:00.000Z", 5);
      for (let i = 0; i < count; i++) log.attempt(s, "2026-11-22T09:01:00.000Z");
    }

    const [total, mean, median] = subject.charts.map((spec) => chartSeries(subject, spec, log.events, { now: NOW }));

    expect(values(total!)).toEqual([
      ["2026-11-21", 0],
      ["2026-11-22", 9],
    ]);
    expect(values(mean!)).toEqual([
      ["2026-11-21", null],
      ["2026-11-22", 3],
    ]);
    expect(values(median!)).toEqual([
      ["2026-11-21", null],
      ["2026-11-22", 2],
    ]);
    expect(total!.unit).toBeNull();
  });

  it("sums session minutes on the day each session started, or averages them per session", async () => {
    const subject = await subjectWith([
      { ...chart, id: "c6", measure: "minutes", days: 2 },
      { ...chart, id: "c7", measure: "minutes", aggregate: "median", days: 2 },
    ]);
    const log = new Log();
    log.session("2026-11-21T23:50:00.000Z", 20);
    log.session("2026-11-21T10:00:00.000Z", 10);
    log.session("2026-11-22T10:00:00.000Z", 3);

    const [total, median] = subject.charts.map((spec) => chartSeries(subject, spec, log.events, { now: NOW }));

    expect(total).toMatchObject({ measure: "minutes", aggregate: "total", unit: "min" });
    expect(values(total!)).toEqual([
      ["2026-11-21", 30],
      ["2026-11-22", 3],
    ]);
    expect(values(median!)).toEqual([
      ["2026-11-21", 15],
      ["2026-11-22", 3],
    ]);
  });

  it("keeps only the attempts on items with the tag or type, or in the drill's sessions", async () => {
    const subject = await subjectWith([
      { ...chart, id: "c8", measure: "attempts", items: { tag: "word" }, days: 1 },
      { ...chart, id: "c9", measure: "attempts", items: { type: "timed-audio" }, days: 1 },
      { ...chart, id: "c10", measure: "attempts", items: { drill: "listen" }, days: 1 },
      { ...chart, id: "c11", measure: "minutes", items: { drill: "listen" }, days: 1 },
    ]);
    const log = new Log();
    const lesson = log.session("2026-11-22T09:00:00.000Z", 5);
    log.attempt(lesson, "2026-11-22T09:01:00.000Z", { ref: "item:word-ok" });
    log.attempt(lesson, "2026-11-22T09:02:00.000Z", { ref: "item:letter-m" });
    const drill = log.session("2026-11-22T10:00:00.000Z", 7, "drill:listen");
    log.attempt(drill, "2026-11-22T10:01:00.000Z", { ref: "item:letter-k" });
    log.attempt(drill, "2026-11-22T10:02:00.000Z", { ref: "item:letter-m" });
    log.attempt(drill, "2026-11-22T10:03:00.000Z", { ref: "item:word-ok" });

    const series = subject.charts.map((spec) => values(chartSeries(subject, spec, log.events, { now: NOW })));

    expect(series).toEqual([[["2026-11-22", 2]], [["2026-11-22", 3]], [["2026-11-22", 3]], [["2026-11-22", 7]]]);
  });

  it("ends the window on today and splits days in the home's timezone", async () => {
    const subject = await subjectWith([{ ...chart, measure: "attempts", days: 2 }], "Pacific/Auckland");
    const log = new Log();
    log.attempt(log.session("2026-11-22T10:58:00.000Z", 1), "2026-11-22T10:59:00.000Z");
    log.attempt(log.session("2026-11-22T11:00:00.000Z", 1), "2026-11-22T11:01:00.000Z");

    const series = chartSeries(subject, subject.charts[0]!, log.events, { now: NOW });

    expect(values(series)).toEqual([
      ["2026-11-22", 1],
      ["2026-11-23", 1],
    ]);
  });

  it("counts a session's attempts on the day of its first attempt", async () => {
    const subject = await subjectWith([{ ...chart, measure: "attempts", aggregate: "median", days: 2 }]);
    const log = new Log();
    const s = log.session("2026-11-21T23:50:00.000Z", 30);
    log.attempt(s, "2026-11-21T23:55:00.000Z");
    log.attempt(s, "2026-11-22T00:05:00.000Z");

    expect(values(chartSeries(subject, subject.charts[0]!, log.events, { now: NOW }))).toEqual([
      ["2026-11-21", 2],
      ["2026-11-22", null],
    ]);
  });

  it("refuses minutes filtered by item, which validation reports", async () => {
    const subject = await subjectWith([]);
    const spec = { id: "m", title: "M", kind: "bar", measure: "minutes", aggregate: "total", items: { tag: "letter" }, days: 1 } as const;

    expect(() => chartSeries(subject, spec, [], { now: NOW })).toThrow(RangeError);
  });
});
