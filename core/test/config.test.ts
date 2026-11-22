import { describe, expect, it } from "vitest";
import { InvalidLearningHomeError, loadLearningHome, UnsupportedFormatVersionError } from "@tomewise/core";
import { buildHome, snapshot } from "./helpers.ts";

describe("loading tomewise.json", () => {
  it("applies defaults for timezone, week start, minimum session length and theme", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1 } });

    const { config } = await loadLearningHome(home);

    expect(config).toEqual({
      formatVersion: 1,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      weekStart: "monday",
      minimumSessionSeconds: 60,
      streak: { restDaysPerWeek: 0 },
      theme: "paper",
      git: { enabled: false, cadence: "session", push: false, pullIntervalMinutes: 5 },
    });
  });

  it("turns git sync on with defaults for an empty git block", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1, git: {} } });

    const { config } = await loadLearningHome(home);

    expect(config.git).toEqual({ enabled: true, cadence: "session", push: false, pullIntervalMinutes: 5 });
  });

  it("keeps the values the learner set", async () => {
    const home = await buildHome({
      "tomewise.json": {
        formatVersion: 1,
        timezone: "Pacific/Auckland",
        weekStart: "sunday",
        minimumSessionSeconds: 120,
        streak: { restDaysPerWeek: 2 },
        theme: "meadow",
        git: { enabled: true, cadence: "daily", remote: "origin", branch: "main", push: true, pullIntervalMinutes: 15 },
      },
    });

    const { config } = await loadLearningHome(home);

    expect(config).toEqual({
      formatVersion: 1,
      timezone: "Pacific/Auckland",
      weekStart: "sunday",
      minimumSessionSeconds: 120,
      streak: { restDaysPerWeek: 2 },
      theme: "meadow",
      git: { enabled: true, cadence: "daily", remote: "origin", branch: "main", push: true, pullIntervalMinutes: 15 },
    });
  });
});

describe("format version", () => {
  it("refuses a learning home newer than the tool supports, without writing anything", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 2, someNewField: true } });
    const before = await snapshot(home);

    const load = loadLearningHome(home);

    await expect(load).rejects.toBeInstanceOf(UnsupportedFormatVersionError);
    await expect(load).rejects.toThrow(/formatVersion 2/);
    await expect(load).rejects.toThrow(/supports up to 1/);
    expect(await snapshot(home)).toEqual(before);
  });
});

describe("loading an invalid tomewise.json", () => {
  it("fails with the same issues validation reports", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1, weekStart: "funday" } });

    const error = await loadLearningHome(home).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidLearningHomeError);
    expect((error as InvalidLearningHomeError).issues).toEqual([
      { file: "tomewise.json", path: "weekStart", message: expect.stringContaining("monday") },
    ]);
  });
});

describe("loading invalid git settings", () => {
  it("names each bad git setting", async () => {
    const home = await buildHome({
      "tomewise.json": { formatVersion: 1, git: { cadence: "weekly", branch: "-x", pullIntervalMinutes: 0, push: true } },
    });

    const error = await loadLearningHome(home).catch((e: unknown) => e);

    expect((error as InvalidLearningHomeError).issues).toEqual([
      { file: "tomewise.json", path: "git.cadence", message: expect.stringContaining("hourly") },
      { file: "tomewise.json", path: "git.branch", message: expect.stringContaining("branch") },
      { file: "tomewise.json", path: "git.pullIntervalMinutes", message: expect.any(String) },
    ]);
  });

  it("refuses push without a remote", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1, git: { push: true } } });

    const error = await loadLearningHome(home).catch((e: unknown) => e);

    expect((error as InvalidLearningHomeError).issues).toEqual([
      { file: "tomewise.json", path: "git.push", message: expect.stringContaining("remote") },
    ]);
  });
});
