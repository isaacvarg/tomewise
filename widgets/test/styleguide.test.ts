import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { snapshot, writeFiles } from "../../core/test/helpers.ts";
import { widgetClasses } from "../../core/src/theme-contract.ts";
import { startWidgetApp } from "./browser.ts";

async function openStyleguide(query = "", options: Parameters<typeof startWidgetApp>[0] = {}) {
  const app = await startWidgetApp(options);
  const page = await app.open(`/styleguide${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.styleguide, undefined, { timeout: 15000 });
  return { ...app, page };
}

const stateOf = (page: Page, caption: string, selector: string) =>
  page
    .locator("figure.styleguide-state")
    .filter({ has: page.locator("figcaption", { hasText: new RegExp(`^${caption}$`) }) })
    .locator(selector)
    .first()
    .getAttribute("data-state");

describe("/styleguide", () => {
  it("drives every demo into its state without errors", async () => {
    const { page, pageErrors } = await openStyleguide();

    expect(await page.evaluate(() => document.documentElement.dataset.styleguideErrors ?? "")).toBe("");
    expect(await page.evaluate(() => document.documentElement.dataset.styleguide)).toBe("ready");
    expect(pageErrors).toEqual([]);
  });

  it("shows every widget", async () => {
    const { page } = await openStyleguide();

    for (const tag of Object.keys(widgetClasses)) {
      expect(await page.locator(`${tag} > .${tag}`).count(), tag).toBeGreaterThan(0);
    }
  });

  it.each([
    ["front", ".tome-flashcard", "front"],
    ["back", ".tome-flashcard", "back"],
    ["saved · good", ".tome-verdict", "correct"],
    ["saved · again", ".tome-verdict", "wrong"],
    ["saved · correct", ".tome-choice .tome-verdict", "correct"],
    ["saved · wrong", ".tome-choice .tome-verdict", "wrong"],
    ["saved · skipped", ".tome-verdict", "skipped"],
    ["failed save", '.tome-notice[data-state="unsaved"]', "unsaved"],
    ["error · unknown item", ".tome-flashcard", "error"],
    ["answering", ".tome-audio", "answering"],
    ["rate", ".tome-routine", "rate"],
    ["paused", ".tome-timer", "paused"],
    ["done", ".tome-timer", "done"],
    ["saved", ".tome-explain", "saved"],
    ["answered", ".tome-exam-question", "answered"],
    ["error · no tests", ".tome-exam-question", "error"],
    ["done", ".tome-drill", "done"],
    ["empty · nothing due", ".tome-drill", "empty"],
    ["error · unknown drill", ".tome-drill", "error"],
  ])("shows %s (%s is %s)", async (caption, selector, state) => {
    const { page } = await openStyleguide();

    expect(await stateOf(page, caption, selector)).toBe(state);
  });

  it("writes nothing to the learning home", async () => {
    const app = await startWidgetApp();
    const before = await snapshot(app.app.root);

    const page = await app.open("/styleguide");
    await page.waitForFunction(() => document.documentElement.dataset.styleguide, undefined, { timeout: 15000 });

    expect(await snapshot(app.app.root)).toEqual(before);
  });

  it("renders another theme with ?theme= and a mode with ?mode=", async () => {
    const { page } = await openStyleguide("?theme=moss&mode=dark", {
      prepare: (root) =>
        writeFiles(root, {
          "themes/moss/theme.json": { name: "Moss", author: "Me", version: "0.1.0" },
          "themes/moss/tokens.css": ":root { --t-bg: rgb(1, 2, 3); } :root[data-mode='dark'] { --t-bg: rgb(4, 5, 6); }",
        }),
    });

    expect(await page.locator('meta[name="tome-theme"]').getAttribute("content")).toBe("moss");
    expect(await page.evaluate(() => document.documentElement.dataset.mode)).toBe("dark");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe("rgb(4, 5, 6)");
  });
});
