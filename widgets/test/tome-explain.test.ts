import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

const LESSON = "/s/spanish/lessons/0001-greetings.html";
const SUBJECT = "spanish";

const explanations = (events: LearningEvent[]) => events.filter((event) => event.kind === "explanation.saved");

async function openLesson(options: Parameters<typeof startWidgetApp>[0] = {}) {
  const widgets = await startWidgetApp({
    ...options,
    prepare: (root) =>
      writeFile(
        join(root, "subjects/spanish/lessons/0001-greetings.html"),
        [
          "<!doctype html><title>Greetings</title>",
          '<tome-explain ref="lesson:0001-greetings" prompt="Why do we say hola?"></tome-explain>',
          '<tome-explain ref="item:hola"></tome-explain>',
        ].join("\n"),
      ),
  });
  const page = await widgets.open(LESSON);
  const lesson = page.locator('tome-explain[ref="lesson:0001-greetings"]');
  const item = page.locator('tome-explain[ref="item:hola"]');
  await expect.poll(() => lesson.locator(".tome-explain-text").count()).toBe(1);
  await expect.poll(() => item.locator(".tome-explain-text").count()).toBe(1);
  return { ...widgets, page, lesson, item };
}

describe("<tome-explain>", () => {
  it("saves the explanation with its ref and the text in data", async () => {
    const { lesson, eventsUntil } = await openLesson();

    expect(await lesson.locator(".tome-prompt").textContent()).toContain("Why do we say hola?");
    await lesson.getByRole("textbox").fill("  It is how you greet someone.  ");
    await lesson.getByRole("button", { name: "Save explanation" }).click();

    const events = await eventsUntil(SUBJECT, (events) => explanations(events).length === 1);
    const [start] = events;
    const [saved] = explanations(events);
    expect(saved).toMatchObject({
      subject: SUBJECT,
      kind: "explanation.saved",
      ref: "lesson:0001-greetings",
      sessionId: start!.id,
      schemaVersion: 1,
      data: { text: "It is how you greet someone." },
    });
    expect(saved).not.toHaveProperty("grade");
    await expect.poll(() => lesson.locator(".tome-verdict").textContent()).toContain("Saved");
    expect(await lesson.locator(".tome-explain").getAttribute("data-state")).toBe("saved");
    expect(await lesson.getByRole("textbox").inputValue()).toBe("  It is how you greet someone.  ");
  });

  it("saves an explanation of an item, and a revision after editing", async () => {
    const { item, eventsUntil } = await openLesson();
    const save = item.getByRole("button", { name: "Save explanation" });

    await item.getByRole("textbox").fill("Hello.");
    await save.click();
    await expect.poll(() => item.locator(".tome-verdict").count()).toBe(1);
    expect(await save.isDisabled()).toBe(true);
    await item.getByRole("textbox").fill("Hello, said to anyone.");
    expect(await item.locator(".tome-verdict").count()).toBe(0);
    await save.click();

    const events = await eventsUntil(SUBJECT, (events) => explanations(events).length === 2);
    expect(explanations(events).map((event) => [event.ref, event.data.text])).toEqual([
      ["item:hola", "Hello."],
      ["item:hola", "Hello, said to anyone."],
    ]);
  });

  it("can't save empty text", async () => {
    const { page, lesson, events } = await openLesson();
    const save = lesson.getByRole("button", { name: "Save explanation" });

    expect(await save.isDisabled()).toBe(true);
    await lesson.getByRole("textbox").fill("   \n ");
    expect(await save.isDisabled()).toBe(true);
    await lesson.getByRole("textbox").press("Control+Enter");
    await page.waitForTimeout(300);

    expect(explanations(await events(SUBJECT))).toEqual([]);
    expect(await lesson.locator(".tome-verdict").count()).toBe(0);
  });

  it("works by keyboard", async () => {
    const { page, lesson, eventsUntil } = await openLesson();

    await page.keyboard.press("Tab");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest("tome-explain")?.getAttribute("ref")))
      .toBe("lesson:0001-greetings");
    await page.keyboard.type("Greeting.");
    await page.keyboard.press("Control+Enter");

    const [saved] = explanations(await eventsUntil(SUBJECT, (events) => explanations(events).length === 1));
    expect(saved).toMatchObject({ ref: "lesson:0001-greetings", data: { text: "Greeting." } });
    await expect.poll(() => lesson.locator(".tome-verdict").count()).toBe(1);
  });

  it("works by touch", async () => {
    const { item, eventsUntil } = await openLesson({ context: { hasTouch: true, isMobile: true } });

    await item.getByRole("textbox").tap();
    await item.getByRole("textbox").fill("Hello.");
    await item.getByRole("button", { name: "Save explanation" }).tap();

    const [saved] = explanations(await eventsUntil(SUBJECT, (events) => explanations(events).length === 1));
    expect(saved).toMatchObject({ ref: "item:hola", data: { text: "Hello." } });
  });

  it("keeps the text on screen and says so when the app can't be reached", async () => {
    const { app, lesson, eventsUntil } = await openLesson();
    await lesson.getByRole("textbox").click();
    await eventsUntil(SUBJECT, (events) => events.length === 1);
    await app.stop();

    await lesson.getByRole("textbox").fill("It is how you greet someone.");
    await lesson.getByRole("button", { name: "Save explanation" }).click();

    const notice = lesson.locator(".tome-notice");
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await lesson.getByRole("textbox").inputValue()).toBe("It is how you greet someone.");
    expect(await lesson.getByRole("button", { name: "Save explanation" }).isEnabled()).toBe(true);
    expect(await lesson.locator(".tome-verdict").count()).toBe(0);
  });

  it("renders in the light DOM with .tome-* classes styled only by --t-* tokens", async () => {
    const { page, lesson } = await openLesson();

    expect(await lesson.evaluate((element) => element.shadowRoot)).toBeNull();
    for (const name of ["tome-explain", "tome-prompt", "tome-explain-text", "tome-save", "tome-hint"]) {
      expect(await lesson.locator(`.${name}`).count(), name).toBeGreaterThan(0);
    }
    const css = await page.evaluate(() =>
      document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n"),
    );
    const classes = [...css.replaceAll("@layer tome.widgets", "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    const variables = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
    expect(css).toContain(".tome-explain");
    expect(classes.filter((name) => !name!.startsWith("tome-"))).toEqual([]);
    expect(variables.filter((name) => !name!.startsWith("--t-"))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});

describe("tome.explain", () => {
  async function run(page: import("playwright").Page, script: string) {
    return page.evaluate(`import("/widgets/v1/tome.js").then(({ tome }) => ${script})`);
  }

  it("is callable from page scripts", async () => {
    const { page, eventsUntil } = await openLesson();

    const saved = (await run(page, 'tome.explain("Hola greets.", "item:hola")')) as LearningEvent;

    expect(saved).toMatchObject({ kind: "explanation.saved", ref: "item:hola", data: { text: "Hola greets." } });
    const events = await eventsUntil(SUBJECT, (events) => explanations(events).length === 1);
    expect(explanations(events)[0]).toMatchObject({ id: saved.id });
  });

  it("rejects empty text without posting", async () => {
    const { page, events } = await openLesson();

    const message = await run(page, 'tome.explain("  ", "item:hola").then(() => "saved", (error) => error.name + ": " + error.message)');

    expect(message).toMatch(/^TomeError: .*empty/i);
    expect(explanations(await events(SUBJECT))).toEqual([]);
  });
});
