import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

const SUBJECT = "morse-code";
const LESSON = "/s/morse-code/lessons/0001-k-and-m.html";
const MORSE = "subjects/morse-code";

const kinds = (events: LearningEvent[]) => events.map((event) => event.kind);
const attempts = (events: LearningEvent[]) => events.filter((event) => event.kind === "attempt");

interface LessonOptions {
  widgets?: string;
  timeLimitSeconds?: number;
  touch?: boolean;
  prepare?: (root: string) => Promise<void>;
}

const BOTH = [
  `<tome-audio ref="item:letter-k" choices="K M" payload='{"wpm":20}'></tome-audio>`,
  `<tome-audio ref="item:letter-m" choices="K M" payload='{"wpm":20}'></tome-audio>`,
].join("\n");

async function openLesson({ widgets = BOTH, timeLimitSeconds, touch, prepare }: LessonOptions = {}) {
  const app = await startWidgetApp({
    context: touch ? { hasTouch: true, isMobile: true } : undefined,
    prepare: async (root) => {
      await rm(join(root, MORSE, "events"), { recursive: true, force: true });
      await writeFile(
        join(root, MORSE, "lessons/0001-k-and-m.html"),
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>K and M</title></head><body>\n${widgets}\n</body></html>`,
      );
      if (timeLimitSeconds !== undefined) {
        const file = join(root, MORSE, "items/0001-k-and-m.json");
        const items = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>[];
        await writeFile(file, JSON.stringify(items.map((item) => ({ ...item, timeLimitSeconds }))));
      }
      await prepare?.(root);
    },
  });
  await app.page.addInitScript(() => {
    const plays: string[] = [];
    Object.assign(window, { plays });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      plays.push(this.src);
      return play.call(this);
    };
  });
  const page = await app.open(LESSON);
  const k = page.locator('tome-audio[ref="item:letter-k"]');
  const m = page.locator('tome-audio[ref="item:letter-m"]');
  await expect.poll(() => page.locator("tome-audio .tome-audio:not([data-state=loading])").count()).toBeGreaterThan(0);
  const plays = () => page.evaluate(() => (window as unknown as { plays: string[] }).plays);
  return { ...app, page, k, m, plays };
}

describe("<tome-audio>", () => {
  it("plays the item's audio and posts a correct answer as grade 3 with the Morse payload", async () => {
    const { page, k, plays, eventsUntil } = await openLesson();

    expect(await k.getByRole("button", { name: "K" }).isDisabled()).toBe(true);
    await k.getByRole("button", { name: "Play the sound" }).click();
    await expect.poll(() => k.getByRole("button", { name: "K" }).isEnabled()).toBe(true);
    await page.waitForTimeout(200);
    await k.getByRole("button", { name: "K" }).click();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(kinds(events)).toEqual(["session.start", "attempt"]);
    const attempt = events[1]!;
    expect(attempt).toMatchObject({
      ref: "item:letter-k",
      sessionId: events[0]!.id,
      outcome: "correct",
      grade: 3,
      schemaVersion: 3,
      data: { heard: "K", answer: "K", wpm: 20 },
    });
    expect(Object.keys(attempt.data).sort()).toEqual(["answer", "heard", "responseTime", "wpm"]);
    expect(Number.isInteger(attempt.duration)).toBe(true);
    expect(attempt.duration).toBeGreaterThanOrEqual(200);
    expect(attempt.data.responseTime).toBe(attempt.duration);
    expect(await plays()).toEqual([expect.stringMatching(/\/s\/morse-code\/assets\/audio\/k\.wav$/)]);
    await expect.poll(() => k.locator(".tome-verdict").getAttribute("data-state")).toBe("correct");
    expect(await k.locator('.tome-answer[data-choice="K"]').getAttribute("data-state")).toBe("correct");
  });

  it("posts a wrong answer as grade 1 and shows what it was", async () => {
    const { m, eventsUntil } = await openLesson();

    await m.getByRole("button", { name: "Play the sound" }).click();
    await expect.poll(() => m.getByRole("button", { name: "K" }).isEnabled()).toBe(true);
    await m.getByRole("button", { name: "K" }).click();

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({
      ref: "item:letter-m",
      outcome: "wrong",
      grade: 1,
      data: { heard: "M", answer: "K", wpm: 20 },
    });
    expect(Number.isInteger(attempt!.duration)).toBe(true);
    expect(await m.locator(".tome-verdict").getAttribute("data-state")).toBe("wrong");
    expect(await m.locator(".tome-say").textContent()).toContain("M");
    expect(await m.locator('.tome-answer[data-choice="K"]').getAttribute("data-state")).toBe("wrong");
    expect(await m.locator('.tome-answer[data-choice="M"]').getAttribute("data-state")).toBe("correct");
  });

  it("can't be answered twice", async () => {
    const { k, events, eventsUntil } = await openLesson();
    await k.getByRole("button", { name: "Play the sound" }).click();
    await expect.poll(() => k.getByRole("button", { name: "M" }).isEnabled()).toBe(true);

    await k.getByRole("button", { name: "M" }).click();
    await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);

    await expect.poll(() => k.getByRole("button", { name: "K" }).isDisabled()).toBe(true);
    await k.press("k");
    expect(attempts(await events(SUBJECT))).toHaveLength(1);
  });

  it("posts a timeout as skipped with grade 1 and an empty answer", async () => {
    const { k, events, eventsUntil } = await openLesson({ timeLimitSeconds: 1 });

    await k.getByRole("button", { name: "Play the sound" }).click();
    await expect.poll(() => k.locator(".tome-countdown").count()).toBe(1);

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({
      ref: "item:letter-k",
      outcome: "skipped",
      grade: 1,
      data: { heard: "K", answer: "", wpm: 20 },
    });
    expect(attempt!.duration).toBeGreaterThanOrEqual(1000);
    expect(attempt!.data.responseTime).toBe(attempt!.duration);
    await expect.poll(() => k.locator(".tome-verdict").getAttribute("data-state")).toBe("skipped");
    expect(await k.locator(".tome-verdict").textContent()).toContain("Out of time");
    expect(await k.getByRole("button", { name: "K" }).isDisabled()).toBe(true);
    await k.press("k");
    expect(attempts(await events(SUBJECT))).toHaveLength(1);
  });

  it("replays by tap and by Space, and counts replays when the payload schema has the field", async () => {
    const { k, plays, eventsUntil } = await openLesson({
      touch: true,
      prepare: async (root) => {
        const file = join(root, MORSE, "subject.json");
        const subject = JSON.parse(await readFile(file, "utf8"));
        const latest = subject.payloadSchemas.at(-1);
        subject.payloadSchemas.push({
          version: latest.version + 1,
          kinds: {
            attempt: { ...latest.kinds.attempt, properties: { ...latest.kinds.attempt.properties, replays: { type: "integer" } } },
          },
        });
        await writeFile(file, JSON.stringify(subject));
      },
    });

    await k.getByRole("button", { name: "Play the sound" }).tap();
    await expect.poll(() => k.getByRole("button", { name: "K" }).isEnabled()).toBe(true);
    await k.getByRole("button", { name: "Play it again" }).tap();
    await k.locator(".tome-play").press(" ");
    await expect.poll(async () => (await plays()).length).toBe(3);
    await k.getByRole("button", { name: "K" }).tap();

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ schemaVersion: 4, outcome: "correct", data: { replays: 2, wpm: 20 } });
  });

  it("works by keyboard", async () => {
    const { page, k, eventsUntil } = await openLesson();

    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toBe("tome-play");
    await page.keyboard.press("Enter");
    await expect.poll(() => k.getByRole("button", { name: "K" }).isEnabled()).toBe(true);
    await page.keyboard.press(" ");
    await page.keyboard.press("k");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:letter-k", outcome: "correct", grade: 3 });
  });

  it("takes a typed answer when the tag has no choices", async () => {
    const { page, k, eventsUntil } = await openLesson({
      widgets: `<tome-audio ref="item:letter-k" payload='{"wpm":20}'></tome-audio>`,
    });

    await k.getByRole("button", { name: "Play the sound" }).click();
    const input = k.getByRole("textbox", { name: "Your answer" });
    await expect.poll(() => input.isEnabled()).toBe(true);
    await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toBe("tome-input");
    await page.keyboard.type(" k ");
    await page.keyboard.press("Enter");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ outcome: "correct", grade: 3, data: { heard: "K", answer: "k" } });
  });

  it("shows a prompt-only item after Start and attaches no payload for a subject without a schema", async () => {
    const { open, eventsUntil } = await startWidgetApp({
      prepare: async (root) => {
        await writeFile(
          join(root, "subjects/spanish/items/0002-thanks.json"),
          JSON.stringify([{ id: "thanks", type: "timed-audio", prompt: "Say thank you", answer: "gracias" }]),
        );
        await writeFile(
          join(root, "subjects/spanish/lessons/0001-greetings.html"),
          '<!doctype html><title>t</title><tome-audio ref="item:thanks"></tome-audio>',
        );
      },
    });
    const page = await open("/s/spanish/lessons/0001-greetings.html");
    const widget = page.locator("tome-audio");

    await expect.poll(() => widget.getByRole("button", { name: "Start" }).count()).toBe(1);
    expect(await widget.locator(".tome-prompt").count()).toBe(0);
    await widget.getByRole("button", { name: "Start" }).click();
    await expect.poll(() => widget.locator(".tome-prompt").textContent()).toBe("Say thank you");
    await widget.getByRole("textbox", { name: "Your answer" }).fill("Gracias");
    await widget.getByRole("button", { name: "Answer" }).click();

    const [, attempt] = await eventsUntil("spanish", (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:thanks", outcome: "correct", grade: 3, data: {} });
  });

  it("surfaces the server's rejection of an invalid payload and keeps the answer on screen", async () => {
    const { k, events, eventsUntil } = await openLesson({
      widgets: `<tome-audio ref="item:letter-k" choices="K M" payload='{"wpm":"fast"}'></tome-audio>`,
    });

    await k.getByRole("button", { name: "Play the sound" }).click();
    await expect.poll(() => k.getByRole("button", { name: "K" }).isEnabled()).toBe(true);
    await k.getByRole("button", { name: "K" }).click();

    const notice = k.locator(".tome-notice");
    await expect.poll(() => notice.textContent()).toContain("didn't accept");
    expect(await notice.textContent()).toContain("data.wpm");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await k.locator('.tome-answer[data-choice="K"]').getAttribute("data-state")).toBe("correct");
    expect(await k.getByRole("button", { name: "Save again" }).isVisible()).toBe(true);
    await eventsUntil(SUBJECT, (events) => events.length === 1);
    expect(kinds(await events(SUBJECT))).toEqual(["session.start"]);
  });

  it("saves again after the app comes back", async () => {
    const { page, k, eventsUntil } = await openLesson();
    await k.getByRole("button", { name: "Play the sound" }).click();
    await expect.poll(() => k.getByRole("button", { name: "K" }).isEnabled()).toBe(true);
    await eventsUntil(SUBJECT, (events) => events.length === 1);
    await page.route("**/api/events", (route) => route.abort());

    await k.getByRole("button", { name: "K" }).click();
    await expect.poll(() => k.locator(".tome-notice").textContent()).toContain("Couldn't reach the app");
    await page.unroute("**/api/events");
    await k.getByRole("button", { name: "Save again" }).click();

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ outcome: "correct", grade: 3, data: { heard: "K", answer: "K" } });
    await expect.poll(() => k.locator(".tome-notice").count()).toBe(0);
  });

  it("shows a visible error for a payload that isn't JSON or an unknown item", async () => {
    const { page, events } = await openLesson({
      widgets: [
        `<tome-audio class="a" ref="item:letter-k" payload="wpm=20"></tome-audio>`,
        `<tome-audio class="b" ref="item:nope"></tome-audio>`,
      ].join("\n"),
    });

    await expect.poll(() => page.locator("tome-audio.a .tome-notice").textContent()).toContain("payload");
    await expect.poll(() => page.locator("tome-audio.b .tome-notice").textContent()).toContain('No item "nope"');
    expect(await events(SUBJECT)).toEqual([]);
  });

  it("renders in the light DOM with .tome-* classes styled only by --t-* tokens", async () => {
    const { page, k } = await openLesson({ timeLimitSeconds: 5 });
    await k.getByRole("button", { name: "Play the sound" }).click();
    await expect.poll(() => k.locator(".tome-countdown").count()).toBe(1);

    expect(await k.evaluate((element) => element.shadowRoot)).toBeNull();
    for (const name of ["tome-audio", "tome-stage", "tome-play", "tome-hint", "tome-feedback", "tome-answers", "tome-answer"]) {
      expect(await k.locator(`.${name}`).count(), name).toBeGreaterThan(0);
    }
    const css = await page.evaluate(() =>
      document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n"),
    );
    const classes = [...css.replaceAll("@layer tome.widgets", "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    const variables = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
    expect(css).toContain(".tome-audio");
    expect(classes.filter((name) => !name!.startsWith("tome-"))).toEqual([]);
    expect(variables.filter((name) => !name!.startsWith("--t-"))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});
