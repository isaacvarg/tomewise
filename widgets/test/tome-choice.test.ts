import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startWidgetApp } from "./browser.ts";
import { attempts, expectThemeable, kinds, LESSON, openAnswers, SUBJECT } from "./answers.ts";

describe("<tome-choice>", () => {
  it("shows the prompt and the item's choices, numbered", async () => {
    const { choice } = await openAnswers();

    const answers = await choice.locator(".tome-answer").allTextContents();
    expect(answers.map((text) => text.trim())).toEqual(["azul1", "rojo2", "verde3"]);
    expect(await choice.locator(".tome-answer kbd").allTextContents()).toEqual(["1", "2", "3"]);
  });

  it("posts a correct attempt with grade 3 and shows the verdict", async () => {
    const { page, choice, eventsUntil } = await openAnswers();
    await page.waitForTimeout(200);

    await choice.getByRole("button", { name: /rojo/ }).click();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    const [start, attempt] = events;
    expect(kinds(events)).toEqual(["session.start", "attempt"]);
    expect(attempt).toMatchObject({
      kind: "attempt",
      ref: "item:rojo",
      sessionId: start!.id,
      outcome: "correct",
      grade: 3,
      data: {},
    });
    expect(Number.isInteger(attempt!.duration)).toBe(true);
    expect(attempt!.duration).toBeGreaterThanOrEqual(200);
    const verdict = choice.locator(".tome-verdict");
    await expect.poll(() => verdict.getAttribute("data-state")).toBe("correct");
    expect(await verdict.textContent()).toContain("Right");
    expect(await choice.locator('.tome-answer[data-state="correct"]').textContent()).toContain("rojo");
  });

  it("posts a wrong attempt with grade 1 and shows the right answer", async () => {
    const { choice, eventsUntil } = await openAnswers();

    await choice.getByRole("button", { name: /azul/ }).click();

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:rojo", outcome: "wrong", grade: 1 });
    const verdict = choice.locator(".tome-verdict");
    await expect.poll(() => verdict.getAttribute("data-state")).toBe("wrong");
    expect(await verdict.textContent()).toContain("rojo");
    expect(await choice.locator('.tome-answer[data-state="wrong"]').textContent()).toContain("azul");
    expect(await choice.locator('.tome-answer[data-state="correct"]').textContent()).toContain("rojo");
  });

  it("posts a skipped attempt with grade 1 when skipped", async () => {
    const { choice, eventsUntil } = await openAnswers();

    await choice.getByRole("button", { name: "Skip" }).click();

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:rojo", outcome: "skipped", grade: 1 });
    const verdict = choice.locator(".tome-verdict");
    await expect.poll(() => verdict.getAttribute("data-state")).toBe("skipped");
    expect(await verdict.textContent()).toContain("rojo");
  });

  it("can't be answered twice", async () => {
    const { choice, eventsUntil, events } = await openAnswers();

    await choice.getByRole("button", { name: /verde/ }).click();
    await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);

    await expect.poll(() => choice.getByRole("button", { name: /rojo/ }).isDisabled()).toBe(true);
    expect(await choice.getByRole("button", { name: "Skip" }).count()).toBe(0);
    await choice.press("2");
    await choice.page().waitForTimeout(200);
    expect(attempts(await events(SUBJECT))).toHaveLength(1);
  });

  it("answers by number key", async () => {
    const { page, choice, eventsUntil } = await openAnswers();

    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("tome-choice") !== null)).toBe(true);
    await page.keyboard.press("2");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:rojo", outcome: "correct", grade: 3 });
    await expect.poll(() => choice.locator(".tome-verdict").getAttribute("data-state")).toBe("correct");
  });

  it("works by touch", async () => {
    const { choice, eventsUntil } = await openAnswers({ context: { hasTouch: true, isMobile: true } });

    await choice.getByRole("button", { name: /verde/ }).tap();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(kinds(events)).toEqual(["session.start", "attempt"]);
    expect(events[1]).toMatchObject({ ref: "item:rojo", outcome: "wrong", grade: 1 });
  });

  it("tells the page once the attempt is saved", async () => {
    const { page, choice } = await openAnswers();
    const answered = page.evaluate(
      () =>
        new Promise((resolve) =>
          document.addEventListener("tome-answered", (event) => resolve((event as CustomEvent).detail), { once: true }),
        ),
    );

    await choice.getByRole("button", { name: /rojo/ }).click();

    expect(await answered).toMatchObject({ ref: "item:rojo", outcome: "correct", grade: 3 });
  });

  it("keeps the answer on screen and saves it again when the app comes back", async () => {
    const { page, choice, events } = await openAnswers();
    await page.route("**/api/events", (route) => route.abort());

    await choice.getByRole("button", { name: /azul/ }).click();

    const notice = choice.locator(".tome-notice");
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await choice.locator('.tome-answer[data-state="wrong"]').textContent()).toContain("azul");
    expect(await events(SUBJECT)).toEqual([]);

    await page.unroute("**/api/events");
    await choice.getByRole("button", { name: "Save again" }).click();

    await expect.poll(async () => attempts(await events(SUBJECT)).length).toBe(1);
    expect(attempts(await events(SUBJECT))[0]).toMatchObject({ ref: "item:rojo", outcome: "wrong", grade: 1 });
    await expect.poll(() => notice.count()).toBe(0);
  });

  it("shows a visible error for an item that isn't multiple choice", async () => {
    const { open, events } = await startWidgetApp({
      prepare: (root) =>
        writeFile(
          join(root, "subjects/spanish/lessons/answers.html"),
          '<!doctype html><title>t</title><tome-choice ref="item:gracias"></tome-choice>',
        ),
    });
    const page = await open(LESSON);

    const notice = page.locator("tome-choice .tome-notice");

    await expect.poll(() => notice.textContent()).toContain('"item:gracias" is a typed-answer item');
    expect(await notice.isVisible()).toBe(true);
    expect(await events(SUBJECT)).toEqual([]);
  });

  it("renders in the light DOM with .tome-* classes styled only by --t-* tokens", async () => {
    const { page, choice } = await openAnswers();
    await choice.getByRole("button", { name: /azul/ }).click();
    await expect.poll(() => choice.locator(".tome-verdict").count()).toBe(1);

    await expectThemeable(page, choice, [
      "tome-choice",
      "tome-stage",
      "tome-prompt",
      "tome-answers",
      "tome-answer",
      "tome-feedback",
      "tome-verdict",
    ]);
  });
});
