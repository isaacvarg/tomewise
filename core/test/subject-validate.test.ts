import { describe, expect, it } from "vitest";
import { validateLearningHome } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const base = {
  "tomewise.json": { formatVersion: 1, timezone: "Europe/London" },
  "subjects/spanish/subject.json": { name: "Spanish" },
  "subjects/spanish/lessons/0001-greetings.html": "<h1>Greetings</h1>",
};

function card(id: string, extra: Record<string, unknown> = {}) {
  return { id, type: "flashcard", front: id, back: id, ...extra };
}

describe("validating subjects and item sets", () => {
  it("reports the file and item path of a bad item field", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/items/0001-greetings.json": [card("hola"), { id: "adios", type: "flashcard", front: "adiós" }],
    });

    expect(await validateLearningHome(home)).toEqual([
      { file: "subjects/spanish/items/0001-greetings.json", path: "[1].back", message: expect.any(String) },
    ]);
  });

  it("names the built-in item types when the type is unknown", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/items/0001-greetings.json": [{ id: "hola", type: "flash-card", front: "hola", back: "hi" }],
    });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/spanish/items/0001-greetings.json",
        path: "[0].type",
        message: "Unknown item type; use one of flashcard, multiple-choice, typed-answer, timed-audio, routine",
      },
    ]);
  });

  it("reports a subject folder without subject.json", async () => {
    const home = await buildHome({ ...base, "subjects/yoga/items/poses.json": [] });

    expect(await validateLearningHome(home)).toEqual([
      { file: "subjects/yoga/subject.json", path: "", message: "File not found" },
    ]);
  });

  it("refuses home-wide settings in subject.json", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/subject.json": { name: "Spanish", settings: { timezone: "Europe/Madrid" } },
    });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/spanish/subject.json",
        path: "settings.timezone",
        message: "timezone is set for the whole learning home in tomewise.json, not per subject",
      },
    ]);
  });

  it("reports a duplicate item id with both locations", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/items/0001-greetings.json": [card("hola"), card("adios")],
      "subjects/spanish/items/0002-more.json": [card("gracias"), card("hola")],
    });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/spanish/items/0002-more.json",
        path: "[1].id",
        message: "Duplicate item id \"hola\"; first used in subjects/spanish/items/0001-greetings.json at [0].id",
      },
    ]);
  });

  it("allows the same item id in different subjects", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/items/0001-greetings.json": [card("hola")],
      "subjects/italian/subject.json": { name: "Italian" },
      "subjects/italian/items/0001-greetings.json": [card("hola")],
    });

    expect(await validateLearningHome(home)).toEqual([]);
  });

  it("reports an item unlocked by a lesson that doesn't exist", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/items/0001-greetings.json": [
        card("hola", { unlockedBy: "0001-greetings" }),
        card("adios", { unlockedBy: "0002-farewells" }),
      ],
    });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/spanish/items/0001-greetings.json",
        path: "[1].unlockedBy",
        message: "No lesson \"0002-farewells\" in subjects/spanish/lessons",
      },
    ]);
  });
});

describe("validating drills", () => {
  it("reports a drill selecting a tag no item has", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/items/0001-greetings.json": [card("hola", { tags: ["word"] }), card("old", { tags: ["verb"], retired: true })],
      "subjects/spanish/drills/mixed.json": { name: "Mixed", select: { from: "unlocked", tags: ["word", "verb", "phrase"] } },
    });

    expect(await validateLearningHome(home)).toEqual([
      { file: "subjects/spanish/drills/mixed.json", path: "select.tags[1]", message: "No unretired item has tag \"verb\"" },
      { file: "subjects/spanish/drills/mixed.json", path: "select.tags[2]", message: "No unretired item has tag \"phrase\"" },
    ]);
  });

  it("reports a bad drill field", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/drills/sprint.json": { name: "Sprint", select: { from: "everything" }, count: 0 },
    });

    expect(await validateLearningHome(home)).toEqual([
      { file: "subjects/spanish/drills/sprint.json", path: "select.from", message: expect.stringContaining("due") },
      { file: "subjects/spanish/drills/sprint.json", path: "count", message: expect.any(String) },
    ]);
  });

  it("keeps the review drill name for the built-in drill", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/drills/review.json": { name: "My review", select: { from: "due" } },
    });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/spanish/drills/review.json",
        path: "",
        message: "\"review\" is the built-in drill that reviews everything due; rename this file",
      },
    ]);
  });
});

describe("validating the curriculum", () => {
  it("reports a milestone with an unknown status", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/curriculum.json": {
        units: [{ title: "Getting by", milestones: [{ id: "say-hello", title: "Say hello", status: "started" }] }],
      },
    });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/spanish/curriculum.json",
        path: "units[0].milestones[0].status",
        message: expect.stringContaining("upcoming"),
      },
    ]);
  });

  it("reports a milestone listing a lesson that doesn't exist", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/curriculum.json": {
        units: [
          {
            title: "Getting by",
            milestones: [
              { id: "say-hello", title: "Say hello", status: "current", lessons: ["0001-greetings", "0002-farewells"] },
            ],
          },
        ],
      },
    });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/spanish/curriculum.json",
        path: "units[0].milestones[0].lessons[1]",
        message: "No lesson \"0002-farewells\" in subjects/spanish/lessons",
      },
    ]);
  });

  it("reports two milestones with the same id", async () => {
    const home = await buildHome({
      ...base,
      "subjects/spanish/curriculum.json": {
        units: [
          { title: "One", milestones: [{ id: "basics", title: "Basics", status: "done" }] },
          { title: "Two", milestones: [{ id: "basics", title: "More basics", status: "upcoming" }] },
        ],
      },
    });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "subjects/spanish/curriculum.json",
        path: "units[1].milestones[0].id",
        message: "Duplicate milestone id \"basics\"; first used at units[0].milestones[0].id",
      },
    ]);
  });

  it("checks drill and subject payloads against the newest attempt schema", async () => {
    const payloadSchemas = [
      { version: 1, kinds: { attempt: { properties: { wpm: { type: "number" } }, required: ["wpm"] } } },
    ];
    const home = await buildHome({
      ...base,
      "subjects/spanish/subject.json": { name: "Spanish", payloadSchemas, drillPayload: { wpm: "fast" } },
      "subjects/spanish/items/0001-greetings.json": [card("hola")],
      "subjects/spanish/drills/ok.json": { name: "OK", select: { from: "due" }, payload: { wpm: 20 } },
      "subjects/spanish/drills/extra.json": { name: "Extra", select: { from: "due" }, payload: { tempo: 3 } },
      "subjects/spanish/drills/asks.json": { name: "Asks", select: { from: "due" }, payload: { question: "q1" } },
    });

    expect(await validateLearningHome(home)).toEqual([
      { file: "subjects/spanish/subject.json", path: "drillPayload.wpm", message: expect.any(String) },
      { file: "subjects/spanish/drills/asks.json", path: "payload.question", message: expect.stringContaining("exam questions") },
      { file: "subjects/spanish/drills/extra.json", path: "payload.tempo", message: "Unknown field" },
    ]);
  });
});
