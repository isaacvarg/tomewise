import { describe, expect, it } from "vitest";
import { loadLearningHome, validateLearningHome } from "@tomewise/core";
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
});
