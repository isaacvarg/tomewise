import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locator } from "playwright";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

const SUBJECT = "spanish";
const LESSON = "/s/spanish/lessons/0002-warm-up.html";

const kinds = (events: LearningEvent[]) => events.map((event) => event.kind);
const attempts = (events: LearningEvent[]) => events.filter((event) => event.kind === "attempt");

const ROUTINE = {
  id: "warm-up",
  type: "routine",
  name: "Warm-up",
  steps: [{ text: "Say the vowels" }, { text: "Hold the rolled r", seconds: 0.6 }, { text: "Say hola three times" }],
};

async function openPage(body: string, options: Parameters<typeof startWidgetApp>[0] = {}) {
  const widgets = await startWidgetApp({
    ...options,
    prepare: async (root) => {
      await writeFile(join(root, "subjects/spanish/items/routines.json"), JSON.stringify([ROUTINE]));
      await writeFile(
        join(root, "subjects/spanish/lessons/0002-warm-up.html"),
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Warm-up</title></head><body>${body}</body></html>`,
      );
    },
  });
  const page = await widgets.open(LESSON);
  return { ...widgets, page };
}

async function openRoutine(options?: Parameters<typeof startWidgetApp>[0]) {
  const widgets = await openPage('<tome-routine ref="item:warm-up"></tome-routine>', options);
  const routine = widgets.page.locator("tome-routine");
  await expect.poll(() => routine.locator(".tome-routine-name").textContent()).toBe("Warm-up");
  return { ...widgets, routine };
}

async function openTimer(seconds: string, options?: Parameters<typeof startWidgetApp>[0]) {
  const widgets = await openPage(`<tome-timer seconds="${seconds}"></tome-timer>`, options);
  const timer = widgets.page.locator("tome-timer");
  await expect.poll(() => timer.locator(".tome-timer").getAttribute("data-state")).toBe("idle");
  return { ...widgets, timer };
}

const stepText = (routine: Locator) =>
  routine.locator(".tome-step").textContent();

describe("<tome-routine>", () => {
  it("guides through each step, then posts one attempt with the self-rating and whole-ms duration", async () => {
    const { page, routine, eventsUntil, pageErrors } = await openRoutine();

    await routine.getByRole("button", { name: "Start" }).click();
    expect(await stepText(routine)).toBe("Say the vowels");
    expect(await routine.locator(".tome-progress").textContent()).toBe("Step 1 of 3");
    await page.waitForTimeout(150);
    await routine.getByRole("button", { name: "Next" }).click();
    await expect.poll(() => stepText(routine)).toBe("Hold the rolled r");
    await routine.getByRole("button", { name: "Next" }).click();
    await expect.poll(() => stepText(routine)).toBe("Say hola three times");
    await routine.getByRole("button", { name: "Finish" }).click();
    await routine.getByRole("button", { name: /Hard/ }).click();
    await expect.poll(() => routine.locator(".tome-verdict").textContent()).toContain("Saved: Hard");

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    const [start, attempt] = events;
    expect(kinds(events)).toEqual(["session.start", "attempt"]);
    expect(attempt).toMatchObject({
      kind: "attempt",
      ref: "item:warm-up",
      sessionId: start!.id,
      outcome: "correct",
      grade: 2,
      data: {},
    });
    expect(Number.isInteger(attempt!.duration)).toBe(true);
    expect(attempt!.duration).toBeGreaterThanOrEqual(150);
    expect(pageErrors).toEqual([]);
  });

  it("rates Again as wrong and can't be rated twice", async () => {
    const { routine, eventsUntil, events } = await openRoutine();
    await routine.getByRole("button", { name: "Start" }).click();
    for (let step = 0; step < 2; step++) await routine.getByRole("button", { name: "Next" }).click();
    await routine.getByRole("button", { name: "Finish" }).click();

    await routine.getByRole("button", { name: /Again/ }).click();

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:warm-up", outcome: "wrong", grade: 1 });
    await expect.poll(() => routine.getByRole("button", { name: /Good/ }).isDisabled()).toBe(true);
    await routine.press("3");
    expect(attempts(await events(SUBJECT))).toHaveLength(1);
  });

  it("runs a visible timer on a timed step", async () => {
    const { routine } = await openRoutine();
    await routine.getByRole("button", { name: "Start" }).click();
    expect(await routine.locator("tome-timer").count()).toBe(0);

    await routine.getByRole("button", { name: "Next" }).click();

    const timer = routine.locator("tome-timer .tome-timer");
    await expect.poll(() => timer.isVisible()).toBe(true);
    expect(await timer.getAttribute("data-state")).toBe("running");
    await expect.poll(() => timer.getAttribute("data-state")).toBe("done");
    await routine.getByRole("button", { name: "Next" }).click();
    expect(await routine.locator("tome-timer").count()).toBe(0);
  });

  it("works by keyboard", async () => {
    const { page, routine, eventsUntil } = await openRoutine();

    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toBe("tome-start");
    await page.keyboard.press("Enter");
    await expect.poll(() => stepText(routine)).toBe("Say the vowels");
    await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toBe("tome-next");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => stepText(routine)).toBe("Hold the rolled r");
    await page.keyboard.press("Enter");
    await expect.poll(() => stepText(routine)).toBe("Say hola three times");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toMatch(/^Good/);
    await page.keyboard.press("4");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:warm-up", outcome: "correct", grade: 4 });
  });

  it("works by touch", async () => {
    const { routine, eventsUntil } = await openRoutine({ context: { hasTouch: true, isMobile: true } });

    await routine.getByRole("button", { name: "Start" }).tap();
    await routine.getByRole("button", { name: "Next" }).tap();
    await routine.getByRole("button", { name: "Next" }).tap();
    await routine.getByRole("button", { name: "Finish" }).tap();
    await routine.getByRole("button", { name: /Good/ }).tap();

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:warm-up", outcome: "correct", grade: 3 });
  });

  it("posts no attempt when the learner leaves midway", async () => {
    const { page, routine, eventsUntil } = await openRoutine();
    await routine.getByRole("button", { name: "Start" }).click();
    await routine.getByRole("button", { name: "Next" }).click();

    await page.goto("about:blank");

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(kinds(events)).toEqual(["session.start", "session.end"]);
  });

  it("shows a visible error for an item that isn't a routine", async () => {
    const { page, events } = await openPage('<tome-routine ref="item:hola"></tome-routine>');

    const notice = page.locator("tome-routine .tome-notice");

    await expect.poll(() => notice.textContent()).toContain('"item:hola" is a flashcard item, not a routine');
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await events(SUBJECT)).toEqual([]);
  });

  it("keeps the rating on screen and says so when the app can't be reached", async () => {
    const { app, routine, eventsUntil } = await openRoutine();
    await routine.getByRole("button", { name: "Start" }).click();
    await eventsUntil(SUBJECT, (events) => events.length === 1);
    for (let step = 0; step < 2; step++) await routine.getByRole("button", { name: "Next" }).click();
    await routine.getByRole("button", { name: "Finish" }).click();
    await app.stop();

    await routine.getByRole("button", { name: /Good/ }).click();

    const notice = routine.locator(".tome-notice");
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await routine.getByRole("button", { name: /Good/ }).isEnabled()).toBe(true);
  });

  it("renders in the light DOM with .tome-* classes styled only by --t-* tokens", async () => {
    const { page, routine } = await openRoutine();
    await routine.getByRole("button", { name: "Start" }).click();
    await routine.getByRole("button", { name: "Next" }).click();

    expect(await routine.evaluate((element) => element.shadowRoot)).toBeNull();
    expect(await routine.locator("tome-timer").evaluate((element) => element.shadowRoot)).toBeNull();
    for (const name of ["tome-routine", "tome-routine-name", "tome-progress", "tome-stage", "tome-step", "tome-next", "tome-timer", "tome-clock"]) {
      expect(await routine.locator(`.${name}`).count(), name).toBeGreaterThan(0);
    }
    const css = await page.evaluate(() =>
      document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n"),
    );
    const classes = [...css.replaceAll("@layer tome.widgets", "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    const variables = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
    expect(css).toContain(".tome-routine");
    expect(css).toContain(".tome-timer");
    expect(classes.filter((name) => !name!.startsWith("tome-"))).toEqual([]);
    expect(variables.filter((name) => !name!.startsWith("--t-"))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});

describe("<tome-timer>", () => {
  it("counts down from its seconds once started, then shows done", async () => {
    const { timer, events, pageErrors } = await openTimer("1");
    const clock = timer.locator(".tome-clock");
    expect(await clock.textContent()).toBe("0:01");

    await timer.getByRole("button", { name: "Start" }).click();

    expect(await timer.locator(".tome-timer").getAttribute("data-state")).toBe("running");
    await expect.poll(() => timer.locator(".tome-timer").getAttribute("data-state"), { timeout: 3000 }).toBe("done");
    expect(await clock.textContent()).toBe("0:00");
    expect(await timer.getByRole("button", { name: "Start" }).count()).toBe(0);
    expect(await events(SUBJECT)).toEqual([expect.objectContaining({ kind: "session.start" })]);
    expect(pageErrors).toEqual([]);
  });

  it("formats minutes", async () => {
    const { timer } = await openTimer("90");

    expect(await timer.locator(".tome-clock").textContent()).toBe("1:30");
  });

  it("pauses, resumes and resets", async () => {
    const { page, timer } = await openTimer("1");
    const state = () => timer.locator(".tome-timer").getAttribute("data-state");
    const remaining = () => timer.evaluate((element) => (element as unknown as { remaining: number }).remaining);

    await timer.getByRole("button", { name: "Start" }).click();
    await page.waitForTimeout(200);
    await timer.getByRole("button", { name: "Pause" }).click();
    expect(await state()).toBe("paused");
    const paused = await remaining();
    expect(paused).toBeLessThan(1000);
    await page.waitForTimeout(1100);
    expect(await state()).toBe("paused");
    expect(await remaining()).toBe(paused);

    await timer.getByRole("button", { name: "Resume" }).click();
    expect(await state()).toBe("running");
    await timer.getByRole("button", { name: "Reset" }).click();
    expect(await state()).toBe("idle");
    expect(await remaining()).toBe(1000);
    expect(await timer.locator(".tome-clock").textContent()).toBe("0:01");
    await page.waitForTimeout(1100);
    expect(await state()).toBe("idle");
  });

  it("resets after done", async () => {
    const { timer } = await openTimer("0.3");
    await timer.getByRole("button", { name: "Start" }).click();
    await expect.poll(() => timer.locator(".tome-timer").getAttribute("data-state")).toBe("done");

    await timer.getByRole("button", { name: "Reset" }).click();

    expect(await timer.locator(".tome-timer").getAttribute("data-state")).toBe("idle");
  });

  it("tells the page when it's done", async () => {
    const { page, timer } = await openTimer("0.3");
    const done = page.evaluate(
      () => new Promise<boolean>((resolve) => document.addEventListener("tome-timer-done", (event) => resolve(event.bubbles))),
    );

    await timer.getByRole("button", { name: "Start" }).click();

    expect(await done).toBe(true);
  });

  it("works by keyboard", async () => {
    const { page, timer } = await openTimer("0.3");

    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Start");
    await page.keyboard.press("Space");

    await expect.poll(() => timer.locator(".tome-timer").getAttribute("data-state")).toBe("done");
  });

  it("works by touch", async () => {
    const { timer } = await openTimer("5", { context: { hasTouch: true, isMobile: true } });

    await timer.getByRole("button", { name: "Start" }).tap();
    await timer.getByRole("button", { name: "Pause" }).tap();

    expect(await timer.locator(".tome-timer").getAttribute("data-state")).toBe("paused");
  });

  it("shows a visible error without valid seconds", async () => {
    const { page } = await openPage('<tome-timer seconds="soon"></tome-timer>');

    const notice = page.locator("tome-timer .tome-notice");

    await expect.poll(() => notice.textContent()).toContain('seconds="soon"');
    expect(await notice.getAttribute("role")).toBe("alert");
  });
});
