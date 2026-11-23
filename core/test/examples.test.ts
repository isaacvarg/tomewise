import { describe, expect, it } from "vitest";
import { loadLearningHome, loadSubject, readEvents, validateLearningHome } from "@tomewise/core";
import { copyExample } from "./helpers.ts";

describe("the Morse example learning home", () => {
  it("validates", async () => {
    const home = await copyExample("morse");

    expect(await validateLearningHome(home)).toEqual([]);
  });

  it("loads with its own settings", async () => {
    const home = await copyExample("morse");

    const { config } = await loadLearningHome(home);

    expect(config.timezone).toBe("Europe/London");
  });

  it("teaches K, M, R, S and U across its lessons", async () => {
    const home = await loadLearningHome(await copyExample("morse"));

    const subject = await loadSubject(home, "morse-code");

    expect(subject.items.map((item) => item.id)).toEqual([
      "letter-k",
      "letter-m",
      "letter-r",
      "letter-s",
      "letter-u",
    ]);
    expect(new Set(subject.items.map((item) => item.unlockedBy)).size).toBeGreaterThan(1);
  });

  it("has a listening drill", async () => {
    const home = await loadLearningHome(await copyExample("morse"));

    const subject = await loadSubject(home, "morse-code");

    expect(subject.drills.map((drill) => drill.id)).toEqual(["review", "listen-kmrsu"]);
  });

  it("has a quiz after lesson 0002-r and the exam its first milestone names", async () => {
    const subject = await loadSubject(await loadLearningHome(await copyExample("morse")), "morse-code");

    expect(subject.quizzes).toEqual(["k-m-r"]);
    expect(subject.quizAfter).toEqual({ "k-m-r": "lesson:0002-r" });
    expect(subject.exams).toEqual(["first-five"]);
    expect(subject.curriculum?.units[0]?.milestones[0]?.exam).toBe("first-five");
  });

  it("records response times and wpm in its attempt payload, with units", async () => {
    const subject = await loadSubject(await loadLearningHome(await copyExample("morse")), "morse-code");

    expect(subject.payloadSchemas.at(-1)?.kinds.attempt?.properties).toEqual({
      heard: { type: "string" },
      answer: { type: "string" },
      responseTime: { type: "integer", unit: "ms" },
      wpm: { type: "number", unit: "wpm" },
    });
  });

  it("has a few sessions of attempts across months and machines, read back in time order", async () => {
    const home = await loadLearningHome(await copyExample("morse"));

    const events = await readEvents(home, "morse-code");
    const sessions = events.filter((e) => e.kind === "session.start");

    expect(sessions.map((e) => [e.ts.slice(0, 10), e.ref])).toEqual([
      ["2026-10-30", "lesson:0001-k-and-m"],
      ["2026-11-02", "lesson:0002-r"],
      ["2026-11-05", "drill:listen-kmrsu"],
      ["2026-11-08", "drill:review"],
    ]);
    expect(events.filter((e) => e.kind === "attempt")).toHaveLength(23);
    expect(events.map((e) => e.ts)).toEqual(events.map((e) => e.ts).toSorted());
  });
});

