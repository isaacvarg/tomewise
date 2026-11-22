import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LearningEvent, startWidgetApp, type WidgetAppOptions } from "./browser.ts";

const LESSON = "/s/spanish/lessons/0001-greetings.html";
const SUBJECT = "spanish";

const kinds = (events: LearningEvent[]) => events.map((event) => event.kind);

async function openLesson(body: string, options: WidgetAppOptions = {}) {
  const widgets = await startWidgetApp({
    ...options,
    prepare: (root) =>
      writeFile(
        join(root, "subjects/spanish/lessons/0001-greetings.html"),
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Greetings</title></head><body>\n${body}\n</body></html>`,
      ),
  });
  const page = await widgets.open(LESSON);
  return { ...widgets, page };
}

async function openDoneLesson(options?: WidgetAppOptions) {
  const widgets = await openLesson("<h1>Greetings</h1>\n<tome-done></tome-done>", options);
  const done = widgets.page.locator("tome-done");
  const button = done.getByRole("button", { name: "Done" });
  await expect.poll(() => button.count()).toBe(1);
  return { ...widgets, done, button };
}

describe("<tome-done>", () => {
  it("posts lesson.completed for the lesson and ends the session", async () => {
    const { done, button, eventsUntil } = await openDoneLesson();

    await button.click();

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(kinds(events)).toEqual(["session.start", "lesson.completed", "session.end"]);
    const [start, completed, end] = events;
    expect(completed).toMatchObject({ kind: "lesson.completed", ref: "lesson:0001-greetings", sessionId: start!.id });
    expect(end).toMatchObject({ kind: "session.end", ref: "lesson:0001-greetings", sessionId: start!.id });
    await expect.poll(() => done.locator(".tome-verdict").textContent()).toContain("Lesson complete");
    expect(await button.isDisabled()).toBe(true);
  });

  it("sends completion once, and no second session.end when the learner leaves", async () => {
    const { page, button, eventsUntil, events } = await openDoneLesson();
    await button.click();
    await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));

    await button.click({ force: true });
    await page.evaluate('import("/widgets/v1/tome.js").then(({ tome }) => tome.complete())');
    await page.goto("about:blank");
    await page.waitForTimeout(300);

    expect(kinds(await events(SUBJECT))).toEqual(["session.start", "lesson.completed", "session.end"]);
  });

  it("works by keyboard", async () => {
    const { page, eventsUntil } = await openDoneLesson();

    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toBe("tome-done-button");
    await page.keyboard.press("Enter");

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(kinds(events)).toEqual(["session.start", "lesson.completed", "session.end"]);
  });

  it("works by touch", async () => {
    const { button, eventsUntil } = await openDoneLesson({ context: { hasTouch: true, isMobile: true } });

    await button.tap();

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(kinds(events)).toEqual(["session.start", "lesson.completed", "session.end"]);
  });

  it("says so and lets the learner retry when the app can't be reached", async () => {
    const { app, done, button } = await openDoneLesson();
    await app.stop();

    await button.click();

    const notice = done.locator(".tome-notice");
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await button.isEnabled()).toBe(true);
  });

  it("renders in the light DOM with .tome-* classes styled only by --t-* tokens", async () => {
    const { page, done, button } = await openDoneLesson();
    await button.click();
    await expect.poll(() => done.locator(".tome-verdict").count()).toBe(1);

    expect(await done.evaluate((element) => element.shadowRoot)).toBeNull();
    for (const name of ["tome-done", "tome-done-button", "tome-verdict"]) {
      expect(await done.locator(`.${name}`).count(), name).toBeGreaterThan(0);
    }
    const css = await page.evaluate(() =>
      document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n"),
    );
    expect(css).toContain(".tome-done");
    const classes = [...css.replaceAll("@layer tome.widgets", "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    const variables = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
    expect(classes.filter((name) => !name!.startsWith("tome-"))).toEqual([]);
    expect(variables.filter((name) => !name!.startsWith("--t-"))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});

describe("tome.complete()", () => {
  it("is callable from a page script", async () => {
    const { page, eventsUntil } = await openLesson(
      [
        '<button id="finish">Finish</button>',
        '<script type="module">',
        'import { tome } from "/widgets/v1/tome.js";',
        'document.getElementById("finish").addEventListener("click", () => tome.complete());',
        "</script>",
      ].join("\n"),
    );

    await page.getByRole("button", { name: "Finish" }).click();

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(kinds(events)).toEqual(["session.start", "lesson.completed", "session.end"]);
    expect(events[1]).toMatchObject({ ref: "lesson:0001-greetings" });
  });
});

describe("a final check", () => {
  it("sends lesson.completed when the learner completes the widget marked final", async () => {
    const { page, eventsUntil, events } = await openLesson(
      [
        '<tome-flashcard ref="item:hola"></tome-flashcard>',
        '<tome-flashcard ref="item:adios" final></tome-flashcard>',
      ].join("\n"),
    );
    const hola = page.locator('tome-flashcard[ref="item:hola"]');
    const adios = page.locator('tome-flashcard[ref="item:adios"]');

    await hola.getByRole("button", { name: "Show answer" }).click();
    await hola.getByRole("button", { name: /Good/ }).click();
    await eventsUntil(SUBJECT, (events) => kinds(events).includes("attempt"));
    await page.waitForTimeout(200);
    expect(kinds(await events(SUBJECT))).not.toContain("lesson.completed");

    await adios.getByRole("button", { name: "Show answer" }).click();
    await adios.getByRole("button", { name: /Again/ }).click();

    const all = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(kinds(all)).toEqual(["session.start", "attempt", "attempt", "lesson.completed", "session.end"]);
    expect(all[3]).toMatchObject({ ref: "lesson:0001-greetings", sessionId: all[0]!.id });
  });

  it("and a Done press afterwards sends nothing more", async () => {
    const { page, eventsUntil, events } = await openLesson(
      ['<tome-flashcard ref="item:hola" final></tome-flashcard>', "<tome-done></tome-done>"].join("\n"),
    );
    const hola = page.locator("tome-flashcard");
    await hola.getByRole("button", { name: "Show answer" }).click();
    await hola.getByRole("button", { name: /Easy/ }).click();
    await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));

    await page.locator("tome-done").getByRole("button", { name: "Done" }).click();
    await page.goto("about:blank");
    await page.waitForTimeout(300);

    expect(kinds(await events(SUBJECT))).toEqual(["session.start", "attempt", "lesson.completed", "session.end"]);
  });
});
