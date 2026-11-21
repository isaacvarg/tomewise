import { describe, expect, it } from "vitest";
import { loadLearningHome, loadSubject, validateLearningHome } from "@tomewise/core";
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
});
