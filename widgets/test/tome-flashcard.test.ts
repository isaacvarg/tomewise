import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

const LESSON = "/s/spanish/lessons/0001-greetings.html";
const SUBJECT = "spanish";

const kinds = (events: LearningEvent[]) => events.map((event) => event.kind);
const attempts = (events: LearningEvent[]) => events.filter((event) => event.kind === "attempt");

async function openLesson(options?: Parameters<typeof startWidgetApp>[0]) {
  const widgets = await startWidgetApp(options);
  const page = await widgets.open(LESSON);
  const hola = page.locator('tome-flashcard[ref="item:hola"]');
  const adios = page.locator('tome-flashcard[ref="item:adios"]');
  await expect.poll(() => hola.locator(".tome-front").textContent()).toBe("hola");
  await expect.poll(() => adios.locator(".tome-front").textContent()).toBe("adiós");
  return { ...widgets, page, hola, adios };
}

describe("tome.js", () => {
  it("is served at /widgets/v1/tome.js as a module", async () => {
    const { app } = await startWidgetApp();

    const response = await app.raw("/widgets/v1/tome.js");

    expect(response.status).toBe(200);
    expect(response.type).toBe("text/javascript; charset=utf-8");
    expect(response.body.toString()).toMatch(/export\s*\{/);
  });

  it("posts nothing when a lesson loads", async () => {
    const { page, events, pageErrors } = await openLesson();

    await page.waitForTimeout(300);

    expect(await events(SUBJECT)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  it("starts a session for the lesson on first interaction", async () => {
    const { hola, eventsUntil } = await openLesson();

    await hola.getByRole("button", { name: "Show answer" }).click();

    const [start, ...rest] = await eventsUntil(SUBJECT, (events) => events.length > 0);
    expect(rest).toEqual([]);
    expect(start).toMatchObject({
      subject: SUBJECT,
      kind: "session.start",
      ref: "lesson:0001-greetings",
      schemaVersion: 1,
      data: {},
    });
    expect(start!.sessionId).toBe(start!.id);
  });

  it("refers the session to the page kind named in the page context", async () => {
    const { open, eventsUntil } = await startWidgetApp({
      prepare: async (root) => {
        await mkdir(join(root, "subjects/spanish/quizzes"), { recursive: true });
        await writeFile(
          join(root, "subjects/spanish/quizzes/week-1.html"),
          [
            '<!doctype html><head><meta name="tome-subject" content="spanish">',
            '<meta name="tome-page-kind" content="quiz"><meta name="tome-quiz" content="week-1">',
            '<script type="module" src="/widgets/v1/tome.js"></script></head>',
            '<tome-flashcard ref="item:hola"></tome-flashcard>',
          ].join("\n"),
        );
      },
    });
    const page = await open("/s/spanish/quizzes/week-1.html");

    await page.getByRole("button", { name: "Show answer" }).click();

    const [start] = await eventsUntil(SUBJECT, (events) => events.length === 1);
    expect(start).toMatchObject({ kind: "session.start", ref: "quiz:week-1" });
  });

  it("ends the session with its duration when the learner leaves", async () => {
    const { page, hola, eventsUntil } = await openLesson();
    await hola.getByRole("button", { name: "Show answer" }).click();
    const [start] = await eventsUntil(SUBJECT, (events) => events.length === 1);
    await page.waitForTimeout(250);

    await page.goto("about:blank");

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(kinds(events)).toEqual(["session.start", "session.end"]);
    const end = events[1]!;
    expect(end).toMatchObject({ kind: "session.end", ref: "lesson:0001-greetings", sessionId: start!.id });
    expect(Number.isInteger(end.duration)).toBe(true);
    expect(end.duration).toBeGreaterThanOrEqual(250);
  });

  it("posts nothing when the learner leaves without interacting", async () => {
    const { page, events } = await openLesson();

    await page.goto("about:blank");
    await page.waitForTimeout(300);

    expect(await events(SUBJECT)).toEqual([]);
  });
});

describe("<tome-flashcard>", () => {
  it("posts one attempt per rating, with the self-rating as grade and whole-ms duration", async () => {
    const { page, hola, adios, eventsUntil } = await openLesson();

    await hola.getByRole("button", { name: "Show answer" }).click();
    await expect.poll(() => hola.locator(".tome-back").textContent()).toBe("hello");
    await page.waitForTimeout(200);
    await hola.getByRole("button", { name: /Good/ }).click();
    await expect.poll(() => hola.locator(".tome-verdict").textContent()).toContain("Saved: Good");
    await adios.getByRole("button", { name: "Show answer" }).click();
    await adios.getByRole("button", { name: /Again/ }).click();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 2);
    const [start, first, second] = events;
    expect(kinds(events)).toEqual(["session.start", "attempt", "attempt"]);
    expect(first).toMatchObject({
      kind: "attempt",
      ref: "item:hola",
      sessionId: start!.id,
      outcome: "correct",
      grade: 3,
      schemaVersion: 1,
      data: {},
    });
    expect(Number.isInteger(first!.duration)).toBe(true);
    expect(first!.duration).toBeGreaterThanOrEqual(200);
    expect(second).toMatchObject({ ref: "item:adios", sessionId: start!.id, outcome: "wrong", grade: 1 });
    expect(Number.isInteger(second!.duration)).toBe(true);
  });

  it("can't be rated twice", async () => {
    const { hola, eventsUntil, events } = await openLesson();
    await hola.getByRole("button", { name: "Show answer" }).click();

    await hola.getByRole("button", { name: /Easy/ }).click();
    await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);

    await expect.poll(() => hola.getByRole("button", { name: /Hard/ }).isDisabled()).toBe(true);
    await hola.press("2");
    expect(attempts(await events(SUBJECT))).toHaveLength(1);
  });

  it("works by keyboard", async () => {
    const { page, hola, eventsUntil } = await openLesson();

    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toBe("tome-reveal");
    await page.keyboard.press("Enter");
    await expect.poll(() => hola.locator(".tome-back").textContent()).toBe("hello");
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toMatch(/^Good/);
    await page.keyboard.press("4");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:hola", outcome: "correct", grade: 4 });
  });

  it("works by touch", async () => {
    const { hola, eventsUntil } = await openLesson({ context: { hasTouch: true, isMobile: true } });

    await hola.getByRole("button", { name: "Show answer" }).tap();
    await hola.getByRole("button", { name: /Hard/ }).tap();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(kinds(events)).toEqual(["session.start", "attempt"]);
    expect(events[1]).toMatchObject({ ref: "item:hola", outcome: "correct", grade: 2 });
  });

  it("shows a visible error for an unknown item ref", async () => {
    const { open, events } = await startWidgetApp({
      prepare: (root) =>
        writeFile(
          join(root, "subjects/spanish/lessons/0001-greetings.html"),
          '<!doctype html><title>t</title><tome-flashcard ref="item:nope"></tome-flashcard>',
        ),
    });
    const page = await open(LESSON);

    const notice = page.locator("tome-flashcard .tome-notice");

    await expect.poll(() => notice.textContent()).toContain('No item "nope" in Spanish');
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await notice.isVisible()).toBe(true);
    expect(await events(SUBJECT)).toEqual([]);
  });

  it("keeps the answer on screen and says so when the app can't be reached", async () => {
    const { app, hola, eventsUntil } = await openLesson();
    await hola.getByRole("button", { name: "Show answer" }).click();
    await eventsUntil(SUBJECT, (events) => events.length === 1);
    await app.stop();

    await hola.getByRole("button", { name: /Good/ }).click();

    const notice = hola.locator(".tome-notice");
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await hola.locator(".tome-back").textContent()).toBe("hello");
    expect(await hola.getByRole("button", { name: /Good/ }).isEnabled()).toBe(true);
  });

  it("renders in the light DOM with .tome-* classes styled only by --t-* tokens", async () => {
    const { page, hola } = await openLesson();
    await hola.getByRole("button", { name: "Show answer" }).click();

    expect(await hola.evaluate((element) => element.shadowRoot)).toBeNull();
    for (const name of ["tome-flashcard", "tome-stage", "tome-front", "tome-back", "tome-grades", "tome-grade"]) {
      expect(await hola.locator(`.${name}`).count(), name).toBeGreaterThan(0);
    }
    const css = await page.evaluate(() =>
      document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n"),
    );
    const classes = [...css.replaceAll("@layer tome.widgets", "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    const variables = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
    expect(css).toContain("@layer tome.widgets");
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((name) => !name!.startsWith("tome-"))).toEqual([]);
    expect(variables.length).toBeGreaterThan(0);
    expect(variables.filter((name) => !name!.startsWith("--t-"))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});
