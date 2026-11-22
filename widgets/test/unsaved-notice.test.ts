import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

const SUBJECT = "spanish";
const SPANISH = "subjects/spanish";
const LESSON = "0002-unsaved";
const UNSAVED = ':scope > .tome-notice[data-state="unsaved"]';

const posted = (events: LearningEvent[]) => events.filter((event) => !event.kind.startsWith("session."));

interface Case {
  tag: string;
  body: string;
  url?: string;
  prepare?: (root: string) => Promise<void>;
  ready: (widget: Locator) => Promise<void>;
  answer: (widget: Locator, page: Page) => Promise<void>;
  again: (widget: Locator) => Promise<void>;
  sender?: (widget: Locator) => Locator;
}

const saveAgain = (widget: Locator) => widget.getByRole("button", { name: "Save again" }).click();

const lessonCompleted = JSON.stringify({
  id: "01KE0000000000000000000C10",
  ts: "2026-01-01T10:00:00.000Z",
  subject: SUBJECT,
  kind: "lesson.completed",
  ref: "lesson:answers",
  sessionId: "01KE0000000000000000000S10",
  schemaVersion: 1,
  data: {},
});

const CASES: Case[] = [
  {
    tag: "tome-flashcard",
    body: '<tome-flashcard ref="item:hola"></tome-flashcard>',
    ready: (widget) => widget.getByRole("button", { name: "Show answer" }).click(),
    answer: (widget) => widget.getByRole("button", { name: /Good/ }).click(),
    again: (widget) => widget.getByRole("button", { name: /Good/ }).click(),
  },
  {
    tag: "tome-choice",
    body: '<tome-choice ref="item:rojo"></tome-choice>',
    ready: (widget) => expect.poll(() => widget.locator(".tome-prompt").count()).toBe(1),
    answer: (widget) => widget.getByRole("button", { name: /rojo/ }).click(),
    again: saveAgain,
  },
  {
    tag: "tome-typed",
    body: '<tome-typed ref="item:gracias"></tome-typed>',
    ready: (widget) => expect.poll(() => widget.locator(".tome-prompt").count()).toBe(1),
    answer: async (widget) => {
      await widget.getByRole("textbox", { name: "Your answer" }).fill("gracias");
      await widget.getByRole("textbox", { name: "Your answer" }).press("Enter");
    },
    again: saveAgain,
  },
  {
    tag: "tome-audio",
    body: '<tome-audio ref="item:thanks"></tome-audio>',
    prepare: (root) =>
      writeFile(
        join(root, SPANISH, "items/0002-thanks.json"),
        JSON.stringify([{ id: "thanks", type: "timed-audio", prompt: "Say thank you", answer: "gracias" }]),
      ),
    ready: async (widget) => {
      await widget.getByRole("button", { name: "Start" }).click();
      await widget.getByRole("textbox", { name: "Your answer" }).fill("gracias");
    },
    answer: (widget) => widget.getByRole("button", { name: "Answer" }).click(),
    again: saveAgain,
  },
  {
    tag: "tome-routine",
    body: '<tome-routine ref="item:warm-up"></tome-routine>',
    prepare: (root) =>
      writeFile(
        join(root, SPANISH, "items/routines.json"),
        JSON.stringify([{ id: "warm-up", type: "routine", name: "Warm-up", steps: [{ text: "Say the vowels" }] }]),
      ),
    ready: async (widget) => {
      await widget.getByRole("button", { name: "Start" }).click();
      await widget.getByRole("button", { name: "Finish" }).click();
    },
    answer: (widget) => widget.getByRole("button", { name: /Good/ }).click(),
    again: (widget) => widget.getByRole("button", { name: /Good/ }).click(),
  },
  {
    tag: "tome-explain",
    body: `<tome-explain ref="lesson:${LESSON}"></tome-explain>`,
    ready: (widget) => widget.getByRole("textbox").fill("Hola is how you greet someone."),
    answer: (widget) => widget.getByRole("button", { name: "Save explanation" }).click(),
    again: (widget) => widget.getByRole("button", { name: "Save explanation" }).click(),
  },
  {
    tag: "tome-done",
    body: "<tome-done></tome-done>",
    ready: (widget) => expect.poll(() => widget.getByRole("button", { name: "Done" }).count()).toBe(1),
    answer: (widget) => widget.getByRole("button", { name: "Done" }).click(),
    again: (widget) => widget.getByRole("button", { name: "Done" }).click(),
  },
  {
    tag: "tome-exam-question",
    body: "",
    url: "/s/spanish/exams/final.html",
    ready: (widget) => expect.poll(() => widget.locator(".tome-exam-question").getAttribute("data-state")).toBe("ready"),
    answer: (widget) => widget.getByRole("button", { name: /rojo/ }).click(),
    again: saveAgain,
  },
  {
    tag: "tome-drill",
    body: '<tome-drill drill="review"></tome-drill>',
    prepare: async (root) => {
      await writeFile(join(root, SPANISH, "items/0001-greetings.json"), "[]");
      await writeFile(join(root, SPANISH, "items/answers.json"), JSON.stringify([
        { id: "rojo", type: "multiple-choice", prompt: "Which word means red?", choices: ["azul", "rojo"], answer: "rojo", unlockedBy: "answers" },
      ]));
      await mkdir(join(root, SPANISH, "events"), { recursive: true });
      await writeFile(join(root, SPANISH, "events/2026-01.jsonl"), lessonCompleted + "\n");
    },
    ready: (widget) => expect.poll(() => widget.locator("tome-choice .tome-prompt").count()).toBe(1),
    answer: (widget) => widget.getByRole("button", { name: /rojo/ }).click(),
    again: saveAgain,
    sender: (widget) => widget.locator("tome-choice"),
  },
];

describe("a failed save shows one notice inside the widget that sent it", () => {
  it.each(CASES)("<$tag>", async ({ tag, body, url, prepare, ready, answer, again, sender }) => {
    const { open, events } = await startWidgetApp({
      prepare: async (root) => {
        await writeFile(
          join(root, SPANISH, `lessons/${LESSON}.html`),
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unsaved</title></head><body>${body}</body></html>`,
        );
        await prepare?.(root);
      },
    });
    const page = await open(url ?? `/s/spanish/lessons/${LESSON}.html`);
    const widget = page.locator(tag).first();
    const from = sender?.(widget) ?? widget;
    await ready(widget);
    const before = posted(await events(SUBJECT)).length;
    await page.route("**/api/events", (route) => route.abort());

    await answer(widget, page);

    const notice = from.locator(UNSAVED);
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await widget.locator(".tome-notice").count()).toBe(1);

    await page.unroute("**/api/events");
    await again(widget);

    await expect.poll(async () => posted(await events(SUBJECT)).length).toBeGreaterThan(before);
    await expect.poll(() => widget.locator(".tome-notice").count()).toBe(0);
  });
});
