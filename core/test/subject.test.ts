import { describe, expect, it } from "vitest";
import { loadLearningHome, loadSubject } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

const config = { formatVersion: 1, timezone: "Europe/London" };
const subjectFile = { name: "Spanish" };

describe("loading a subject", () => {
  it("overrides the tomewise.json defaults with the subject's own settings", async () => {
    const root = await buildHome({
      "tomewise.json": { formatVersion: 1, timezone: "Europe/London", weekStart: "sunday" },
      "subjects/morse-code/subject.json": { name: "Morse code", settings: { minimumSessionSeconds: 30 } },
    });

    const subject = await loadSubject(await loadLearningHome(root), "morse-code");

    expect(subject.name).toBe("Morse code");
    expect(subject.settings).toEqual({
      timezone: "Europe/London",
      weekStart: "sunday",
      minimumSessionSeconds: 30,
    });
  });

  it("loads item sets holding every built-in item type", async () => {
    const root = await buildHome({
      "tomewise.json": config,
      "subjects/spanish/subject.json": subjectFile,
      "subjects/spanish/lessons/0001-greetings.html": "<h1>Greetings</h1>",
      "subjects/spanish/items/0001-greetings.json": [
        { id: "hola", type: "flashcard", front: "hola", back: "hello", unlockedBy: "0001-greetings", tags: ["word"] },
        {
          id: "adios",
          type: "multiple-choice",
          prompt: "adiós means…",
          choices: ["hello", "goodbye", "thanks"],
          answer: "goodbye",
          unlockedBy: "0001-greetings",
        },
        { id: "gracias", type: "typed-answer", prompt: "Spanish for thanks", answer: "gracias", accept: ["muchas gracias"] },
        { id: "hola-heard", type: "timed-audio", audio: "assets/hola.mp3", answer: "hola", timeLimitSeconds: 5 },
        {
          id: "warm-up",
          type: "routine",
          name: "Warm-up",
          steps: [{ text: "Say the alphabet" }, { text: "Count to twenty", seconds: 30 }],
          retired: true,
        },
      ],
    });

    const subject = await loadSubject(await loadLearningHome(root), "spanish");

    expect(subject.lessons).toEqual(["0001-greetings"]);
    expect(subject.itemSets.map((set) => set.id)).toEqual(["0001-greetings"]);
    expect(subject.items.map((item) => [item.id, item.type, item.tags, item.retired])).toEqual([
      ["hola", "flashcard", ["word"], false],
      ["adios", "multiple-choice", [], false],
      ["gracias", "typed-answer", [], false],
      ["hola-heard", "timed-audio", [], false],
      ["warm-up", "routine", [], true],
    ]);
    expect(subject.items[3]).toMatchObject({ audio: "assets/hola.mp3", answer: "hola", timeLimitSeconds: 5 });
  });

  it("offers the built-in review drill without a file", async () => {
    const root = await buildHome({ "tomewise.json": config, "subjects/spanish/subject.json": subjectFile });

    const subject = await loadSubject(await loadLearningHome(root), "spanish");

    expect(subject.drills).toEqual([
      { id: "review", builtIn: true, name: "Review everything due", select: { from: "due", tags: [] }, format: "item" },
    ]);
  });

  it("loads drill files alongside the built-in review drill", async () => {
    const root = await buildHome({
      "tomewise.json": config,
      "subjects/spanish/subject.json": subjectFile,
      "subjects/spanish/items/words.json": [{ id: "hola", type: "flashcard", front: "hola", back: "hello", tags: ["word"] }],
      "subjects/spanish/drills/word-sprint.json": {
        name: "Word sprint",
        select: { from: "unlocked", tags: ["word"] },
        count: 20,
        format: "typed-answer",
        timeLimits: { perItemSeconds: 8, totalSeconds: 120 },
      },
    });

    const subject = await loadSubject(await loadLearningHome(root), "spanish");

    expect(subject.drills.map((drill) => [drill.id, drill.builtIn])).toEqual([
      ["review", true],
      ["word-sprint", false],
    ]);
    expect(subject.drills[1]).toMatchObject({
      select: { from: "unlocked", tags: ["word"] },
      count: 20,
      format: "typed-answer",
      timeLimits: { perItemSeconds: 8, totalSeconds: 120 },
    });
  });

  it("loads the optional curriculum", async () => {
    const root = await buildHome({
      "tomewise.json": config,
      "subjects/spanish/subject.json": subjectFile,
      "subjects/spanish/lessons/0001-greetings.html": "<h1>Greetings</h1>",
      "subjects/spanish/curriculum.json": {
        units: [
          {
            title: "Getting by",
            milestones: [
              { id: "say-hello", title: "Say hello", status: "current", lessons: ["0001-greetings"], exam: "say-hello" },
              { id: "order-food", title: "Order food", status: "upcoming" },
            ],
          },
        ],
      },
    });
    const home = await loadLearningHome(root);

    expect((await loadSubject(home, "spanish")).curriculum).toEqual({
      units: [
        {
          title: "Getting by",
          milestones: [
            { id: "say-hello", title: "Say hello", status: "current", lessons: ["0001-greetings"], exam: "say-hello" },
            { id: "order-food", title: "Order food", status: "upcoming", lessons: [] },
          ],
        },
      ],
    });
  });

  it("has no curriculum when the subject has no curriculum.json", async () => {
    const root = await buildHome({ "tomewise.json": config, "subjects/spanish/subject.json": subjectFile });

    expect((await loadSubject(await loadLearningHome(root), "spanish")).curriculum).toBeUndefined();
  });
});
