import { describe, expect, it } from "vitest";
import { loadLearningHome, loadSubject, validateLearningHome } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const FILE = "subjects/morse-code/subject.json";

const payloadSchemas = [
  {
    version: 1,
    kinds: {
      attempt: {
        properties: {
          heard: { type: "string" },
          responseTime: { type: "integer", unit: "ms" },
        },
      },
    },
  },
  {
    version: 2,
    kinds: {
      attempt: {
        properties: {
          heard: { type: "string" },
          responseTime: { type: "integer", unit: "ms" },
          wpm: { type: "number", unit: "wpm" },
        },
      },
    },
  },
];

function home(charts: unknown[]) {
  return buildHome({
    "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
    [FILE]: { name: "Morse code", payloadSchemas, charts },
    "subjects/morse-code/lessons/0001-k-and-m.html": "<h1>K and M</h1>",
    "subjects/morse-code/items/0001-k-and-m.json": [
      { id: "letter-k", type: "timed-audio", answer: "K", audio: "k.wav", tags: ["letter"] },
      { id: "old-k", type: "flashcard", front: "K", back: "-.-", tags: ["retired-tag"], retired: true },
    ],
    "subjects/morse-code/drills/listen.json": { name: "Listen", select: { from: "unlocked" } },
  });
}

const speed = { id: "speed", title: "Response time", kind: "line", measure: "payload", field: "responseTime", days: 30 };

describe("validating chart specs", () => {
  it("accepts a chart of each measure and fills in the default aggregates", async () => {
    const root = await home([
      speed,
      { id: "wpm", title: "Speed", kind: "line", measure: "payload", field: "wpm", aggregate: "mean", days: 14 },
      { id: "accuracy", title: "Accuracy", kind: "line", measure: "accuracy", items: { tag: "letter" }, days: 30 },
      { id: "attempts", title: "Attempts", kind: "bar", measure: "attempts", items: { drill: "review" }, days: 7 },
      { id: "minutes", title: "Minutes", kind: "bar", measure: "minutes", items: { drill: "listen" }, days: 7 },
    ]);

    expect(await validateLearningHome(root)).toEqual([]);
    const subject = await loadSubject(await loadLearningHome(root), "morse-code");
    expect(subject.charts.map((chart) => [chart.id, "aggregate" in chart ? chart.aggregate : null])).toEqual([
      ["speed", "median"],
      ["wpm", "mean"],
      ["accuracy", null],
      ["attempts", "total"],
      ["minutes", "total"],
    ]);
  });

  it("reports a bad spec with its path", async () => {
    const root = await home([speed, { ...speed, id: "bars", kind: "pie", days: 0 }]);

    expect(await validateLearningHome(root)).toEqual([
      { file: FILE, path: "charts[1].kind", message: expect.any(String) },
      { file: FILE, path: "charts[1].days", message: expect.any(String) },
    ]);
  });

  it("names the measures when the measure is unknown", async () => {
    const root = await home([{ id: "time", title: "Time", kind: "bar", measure: "hours", days: 7 }]);

    expect(await validateLearningHome(root)).toEqual([
      { file: FILE, path: "charts[0].measure", message: "Unknown measure; use one of payload, accuracy, attempts, minutes" },
    ]);
  });

  it("requires a field on a payload chart and refuses one elsewhere", async () => {
    const { field: _, ...noField } = speed;
    const root = await home([noField, { id: "count", title: "Count", kind: "bar", measure: "attempts", field: "wpm", days: 7 }]);

    expect(await validateLearningHome(root)).toEqual([
      { file: FILE, path: "charts[0].field", message: expect.any(String) },
      { file: FILE, path: "charts[1].field", message: "Unknown field" },
    ]);
  });

  it("refuses an aggregate on an accuracy chart", async () => {
    const root = await home([{ id: "acc", title: "Accuracy", kind: "line", measure: "accuracy", aggregate: "mean", days: 7 }]);

    expect(await validateLearningHome(root)).toEqual([
      { file: FILE, path: "charts[0].aggregate", message: "Unknown field" },
    ]);
  });

  it("takes one item filter at a time", async () => {
    const root = await home([{ ...speed, items: { tag: "letter", type: "flashcard" } }]);

    expect(await validateLearningHome(root)).toEqual([
      { file: FILE, path: "charts[0].items", message: "Filter items by one of tag, type or drill" },
    ]);
  });

  it("reports a field missing from the attempt payload, naming the known fields", async () => {
    const root = await home([{ ...speed, field: "speed" }]);

    expect(await validateLearningHome(root)).toEqual([
      {
        file: FILE,
        path: "charts[0].field",
        message: "No field \"speed\" in attempt payloads; known fields: heard, responseTime, wpm",
      },
    ]);
  });

  it("reports a field that isn't a number", async () => {
    const root = await home([{ ...speed, field: "heard" }]);

    expect(await validateLearningHome(root)).toEqual([
      { file: FILE, path: "charts[0].field", message: "\"heard\" is not a number, so it can't be charted" },
    ]);
  });

  it("reports a duplicate chart id with the first location", async () => {
    const root = await home([speed, { ...speed, title: "Again" }]);

    expect(await validateLearningHome(root)).toEqual([
      { file: FILE, path: "charts[1].id", message: "Duplicate chart id \"speed\"; first used at charts[0].id" },
    ]);
  });

  it("reports an item filter naming a tag or drill the subject doesn't have", async () => {
    const root = await home([
      { ...speed, id: "a", items: { tag: "word" } },
      { ...speed, id: "b", items: { drill: "send" } },
      { ...speed, id: "c", items: { tag: "retired-tag" } },
    ]);

    expect(await validateLearningHome(root)).toEqual([
      { file: FILE, path: "charts[0].items.tag", message: "No item has tag \"word\"" },
      { file: FILE, path: "charts[1].items.drill", message: "No drill \"send\"; drills: review, listen" },
    ]);
  });

  it("only filters minutes by drill, since time belongs to sessions", async () => {
    const root = await home([{ id: "m", title: "Minutes", kind: "bar", measure: "minutes", items: { tag: "letter" }, days: 7 }]);

    expect(await validateLearningHome(root)).toEqual([
      {
        file: FILE,
        path: "charts[0].items",
        message: "Minutes come from whole sessions, so filter them by drill only",
      },
    ]);
  });
});
