import { describe, expect, it } from "vitest";
import { validateLearningHome } from "@tomewise/core";
import { buildHome } from "./helpers.ts";

describe("validating a learning home", () => {
  it("finds no problems in a valid learning home", async () => {
    const home = await buildHome({
      "tomewise.json": { formatVersion: 1, timezone: "Europe/London", weekStart: "monday" },
    });

    expect(await validateLearningHome(home)).toEqual([]);
  });

  it("reports the file, field path and problem for a bad field", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1, weekStart: "funday" } });

    expect(await validateLearningHome(home)).toEqual([
      { file: "tomewise.json", path: "weekStart", message: expect.stringContaining("monday") },
    ]);
  });

  it("reports a tomewise.json that isn't valid JSON", async () => {
    const home = await buildHome({ "tomewise.json": '{ "formatVersion": 1,' });

    expect(await validateLearningHome(home)).toEqual([
      { file: "tomewise.json", path: "", message: expect.stringMatching(/^Invalid JSON/) },
    ]);
  });

  it("reports a missing formatVersion", async () => {
    const home = await buildHome({ "tomewise.json": {} });

    expect(await validateLearningHome(home)).toEqual([
      { file: "tomewise.json", path: "formatVersion", message: expect.any(String) },
    ]);
  });

  it("reports a timezone that isn't an IANA zone", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1, timezone: "Mars/Olympus_Mons" } });

    expect(await validateLearningHome(home)).toEqual([
      {
        file: "tomewise.json",
        path: "timezone",
        message: 'Unknown timezone "Mars/Olympus_Mons"; use an IANA name such as "Europe/London"',
      },
    ]);
  });

  it("reports a misspelt setting instead of ignoring it", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1, weekstart: "sunday" } });

    expect(await validateLearningHome(home)).toEqual([
      { file: "tomewise.json", path: "weekstart", message: "Unknown field" },
    ]);
  });

  it("reports a newer formatVersion than the tool supports", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 2 } });

    expect(await validateLearningHome(home)).toEqual([
      { file: "tomewise.json", path: "formatVersion", message: expect.stringContaining("supports up to 1") },
    ]);
  });
});
