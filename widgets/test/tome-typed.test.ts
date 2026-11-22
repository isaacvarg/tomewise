import { describe, expect, it } from "vitest";
import { attempts, expectThemeable, kinds, openAnswers, SUBJECT } from "./answers.ts";

describe("<tome-typed>", () => {
  it("posts a correct attempt with grade 3 when the answer is typed and Enter pressed", async () => {
    const { page, typed, eventsUntil } = await openAnswers();
    const input = typed.getByRole("textbox", { name: "Your answer" });
    await page.waitForTimeout(200);

    await input.fill("  Gracias ");
    await input.press("Enter");

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    const [start, attempt] = events;
    expect(kinds(events)).toEqual(["session.start", "attempt"]);
    expect(attempt).toMatchObject({
      kind: "attempt",
      ref: "item:gracias",
      sessionId: start!.id,
      outcome: "correct",
      grade: 3,
      data: {},
    });
    expect(Number.isInteger(attempt!.duration)).toBe(true);
    expect(attempt!.duration).toBeGreaterThanOrEqual(200);
    const verdict = typed.locator(".tome-verdict");
    await expect.poll(() => verdict.getAttribute("data-state")).toBe("correct");
    expect(await verdict.textContent()).toContain("Right");
  });

  it("accepts the item's accept alternatives", async () => {
    const { typed, eventsUntil } = await openAnswers();
    const input = typed.getByRole("textbox", { name: "Your answer" });

    await input.fill("muchas   gracias");
    await input.press("Enter");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:gracias", outcome: "correct", grade: 3 });
  });

  it("posts a wrong attempt with grade 1, keeps the typed answer and shows the right one", async () => {
    const { typed, eventsUntil } = await openAnswers();
    const input = typed.getByRole("textbox", { name: "Your answer" });

    await input.fill("de nada");
    await input.press("Enter");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:gracias", outcome: "wrong", grade: 1 });
    const verdict = typed.locator(".tome-verdict");
    await expect.poll(() => verdict.getAttribute("data-state")).toBe("wrong");
    expect(await verdict.textContent()).toContain("gracias");
    expect(await input.inputValue()).toBe("de nada");
    expect(await input.isEditable()).toBe(false);
  });

  it("posts a skipped attempt with grade 1 when skipped", async () => {
    const { typed, eventsUntil } = await openAnswers();

    await typed.getByRole("button", { name: "Skip" }).click();

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:gracias", outcome: "skipped", grade: 1 });
    const verdict = typed.locator(".tome-verdict");
    await expect.poll(() => verdict.getAttribute("data-state")).toBe("skipped");
    expect(await verdict.textContent()).toContain("gracias");
  });

  it("ignores an empty answer", async () => {
    const { page, typed, events } = await openAnswers();
    const input = typed.getByRole("textbox", { name: "Your answer" });

    await input.fill("   ");
    await input.press("Enter");
    await page.waitForTimeout(300);

    expect(attempts(await events(SUBJECT))).toEqual([]);
    expect(await typed.locator(".tome-verdict").count()).toBe(0);
  });

  it("can't be answered twice", async () => {
    const { typed, eventsUntil, events } = await openAnswers();
    const input = typed.getByRole("textbox", { name: "Your answer" });

    await input.fill("gracias");
    await input.press("Enter");
    await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);

    await expect.poll(() => typed.getByRole("button", { name: "Check" }).isDisabled()).toBe(true);
    await input.press("Enter");
    await typed.page().waitForTimeout(200);
    expect(attempts(await events(SUBJECT))).toHaveLength(1);
  });

  it("works by keyboard alone", async () => {
    const { page, typed, eventsUntil } = await openAnswers();

    await typed.getByRole("textbox", { name: "Your answer" }).focus();
    await page.keyboard.type("gracias");
    await page.keyboard.press("Enter");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:gracias", outcome: "correct", grade: 3 });
  });

  it("works by touch", async () => {
    const { page, typed, eventsUntil } = await openAnswers({ context: { hasTouch: true, isMobile: true } });

    await typed.getByRole("textbox", { name: "Your answer" }).tap();
    await page.keyboard.type("gracias");
    await typed.getByRole("button", { name: "Check" }).tap();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(kinds(events)).toEqual(["session.start", "attempt"]);
    expect(events[1]).toMatchObject({ ref: "item:gracias", outcome: "correct", grade: 3 });
  });

  it("keeps the answer on screen and saves it again when the app comes back", async () => {
    const { page, typed, events } = await openAnswers();
    const input = typed.getByRole("textbox", { name: "Your answer" });
    await page.route("**/api/events", (route) => route.abort());

    await input.fill("gracias");
    await input.press("Enter");

    const notice = typed.locator(".tome-notice");
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await input.inputValue()).toBe("gracias");

    await page.unroute("**/api/events");
    await typed.getByRole("button", { name: "Save again" }).click();

    await expect.poll(async () => attempts(await events(SUBJECT)).length).toBe(1);
    expect(attempts(await events(SUBJECT))[0]).toMatchObject({ ref: "item:gracias", outcome: "correct", grade: 3 });
  });

  it("renders in the light DOM with .tome-* classes styled only by --t-* tokens", async () => {
    const { page, typed } = await openAnswers();
    await typed.getByRole("button", { name: "Skip" }).click();
    await expect.poll(() => typed.locator(".tome-verdict").count()).toBe(1);

    await expectThemeable(page, typed, [
      "tome-typed",
      "tome-stage",
      "tome-prompt",
      "tome-entry",
      "tome-input",
      "tome-submit",
      "tome-feedback",
      "tome-verdict",
    ]);
  });
});
