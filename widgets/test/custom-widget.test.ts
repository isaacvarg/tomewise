import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

const SUBJECT = "morse-code";
const LESSON = "/s/morse-code/lessons/0001-k-and-m.html";
const MORSE = "subjects/morse-code";

const attempts = (events: LearningEvent[]) => events.filter((event) => event.kind === "attempt");

async function openLesson(attributes: string) {
  const widgets = await startWidgetApp({
    prepare: async (root) => {
      await rm(join(root, MORSE, "events"), { recursive: true, force: true });
      await writeFile(
        join(root, MORSE, "lessons/0001-k-and-m.html"),
        [
          "<!doctype html><title>K and M</title>",
          '<script type="module" src="../assets/morse-key.js"></script>',
          `<morse-key ref="item:letter-k" pattern="-.-" ${attributes}></morse-key>`,
        ].join("\n"),
      );
    },
  });
  const page = await widgets.open(LESSON);
  const widget = page.locator("morse-key");
  await expect.poll(() => widget.locator(".tome-input").count()).toBe(1);
  await expect.poll(() => page.evaluate(() => customElements.get("morse-key") !== undefined)).toBe(true);
  return { ...widgets, page, widget };
}

async function answer(widget: Awaited<ReturnType<typeof openLesson>>["widget"], text: string) {
  await widget.getByRole("textbox").fill(text);
  await widget.getByRole("button", { name: "Check" }).click();
}

describe("a custom widget in assets/", () => {
  it("posts attempts through tome.js with a payload the app validates", async () => {
    const { widget, eventsUntil, pageErrors } = await openLesson('wpm="20"');

    await answer(widget, "k");

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    const [start] = events;
    expect(start).toMatchObject({ kind: "session.start", ref: "lesson:0001-k-and-m" });
    const [attempt] = attempts(events);
    expect(attempt).toMatchObject({
      subject: SUBJECT,
      ref: "item:letter-k",
      sessionId: start!.id,
      outcome: "correct",
      grade: 3,
      schemaVersion: 2,
      data: { heard: "K", answer: "k", wpm: 20 },
    });
    expect(attempt!.data.responseTime).toBe(attempt!.duration);
    await expect.poll(() => widget.locator(".tome-verdict").textContent()).toBe("Right");
    expect(pageErrors).toEqual([]);
  });

  it("records a wrong answer with grade 1", async () => {
    const { widget, eventsUntil } = await openLesson('wpm="20"');

    await answer(widget, "M");

    const [attempt] = attempts(await eventsUntil(SUBJECT, (events) => attempts(events).length === 1));
    expect(attempt).toMatchObject({ outcome: "wrong", grade: 1, data: { heard: "K", answer: "M" } });
  });

  it("shows the app's reason in the widget when the payload doesn't match the subject's schema", async () => {
    const { page, widget, events } = await openLesson("");

    await answer(widget, "K");

    const notice = widget.locator('.tome-notice[data-state="unsaved"]');
    await expect.poll(() => notice.textContent()).toContain("wpm");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await widget.getByRole("textbox").inputValue()).toBe("K");
    await page.waitForTimeout(200);
    expect(attempts(await events(SUBJECT))).toEqual([]);
  });

  it("completes the lesson through tome.complete", async () => {
    const { widget, eventsUntil } = await openLesson('wpm="20" final');

    await answer(widget, "K");

    const events = await eventsUntil(SUBJECT, (events) => events.some((event) => event.kind === "session.end"));
    expect(events.map((event) => event.kind)).toEqual(["session.start", "attempt", "lesson.completed", "session.end"]);
    expect(events[2]).toMatchObject({ ref: "lesson:0001-k-and-m", sessionId: events[0]!.id });
  });
});
