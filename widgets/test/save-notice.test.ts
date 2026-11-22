import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

const LESSON = "/s/spanish/lessons/0001-greetings.html";
const SUBJECT = "spanish";

const attempts = (events: LearningEvent[]) => events.filter((event) => event.kind === "attempt");

async function openLesson(options?: Parameters<typeof startWidgetApp>[0]) {
  const widgets = await startWidgetApp(options);
  const page = await widgets.open(LESSON);
  const hola = page.locator('tome-flashcard[ref="item:hola"]');
  const adios = page.locator('tome-flashcard[ref="item:adios"]');
  await expect.poll(() => hola.locator(".tome-front").textContent()).toBe("hola");
  return { ...widgets, page, hola, adios };
}

describe("a failed save", () => {
  it("shows a notice inside the widget that sent it when the app is stopped mid-lesson", async () => {
    const { app, hola, adios, eventsUntil, events } = await openLesson();
    await hola.getByRole("button", { name: "Show answer" }).click();
    await eventsUntil(SUBJECT, (events) => events.length === 1);
    await app.stop();

    await hola.getByRole("button", { name: /Good/ }).click();

    const notice = hola.locator('.tome-notice[data-state="unsaved"]');
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await notice.isVisible()).toBe(true);
    expect(await hola.locator(".tome-front").textContent()).toBe("hola");
    expect(await hola.locator(".tome-back").textContent()).toBe("hello");
    expect(await adios.locator(".tome-notice").count()).toBe(0);
    expect(attempts(await events(SUBJECT))).toEqual([]);
  });

  it("shows the app's message when it rejects the event", async () => {
    const { hola, events } = await openLesson({
      prepare: (root) =>
        writeFile(
          join(root, "subjects/spanish/subject.json"),
          JSON.stringify({
            name: "Spanish",
            payloadSchemas: [
              {
                version: 1,
                kinds: {
                  attempt: { type: "object", properties: { heard: { type: "string" } }, required: ["heard"] },
                },
              },
            ],
          }),
        ),
    });
    await hola.getByRole("button", { name: "Show answer" }).click();

    await hola.getByRole("button", { name: /Good/ }).click();

    const notice = hola.locator('.tome-notice[data-state="unsaved"]');
    await expect.poll(() => notice.textContent()).toContain("The app didn't accept this");
    expect(await notice.textContent()).toContain("heard");
    expect(await hola.locator(".tome-back").textContent()).toBe("hello");
    expect(attempts(await events(SUBJECT))).toEqual([]);
  });

  it("is not queued or retried, and clears once the learner saves again", async () => {
    const { page, hola, eventsUntil, events } = await openLesson();
    await hola.getByRole("button", { name: "Show answer" }).click();
    await eventsUntil(SUBJECT, (events) => events.length === 1);
    let posts = 0;
    await page.route("**/api/events", (route) => {
      posts += 1;
      return route.abort("connectionrefused");
    });

    await hola.getByRole("button", { name: /Good/ }).click();
    const notice = hola.locator('.tome-notice[data-state="unsaved"]');
    await expect.poll(() => notice.count()).toBe(1);
    await page.unroute("**/api/events");
    await page.waitForTimeout(500);

    expect(posts).toBe(1);
    expect(attempts(await events(SUBJECT))).toEqual([]);

    await hola.getByRole("button", { name: /Good/ }).click();

    const saved = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempts(saved)[0]).toMatchObject({ ref: "item:hola", grade: 3 });
    await expect.poll(() => notice.count()).toBe(0);
  });

  it("shows the notice in a custom widget that reports through tome.js", async () => {
    const { app, open } = await startWidgetApp({
      prepare: (root) =>
        writeFile(
          join(root, "subjects/spanish/lessons/0001-greetings.html"),
          [
            "<!doctype html><title>t</title>",
            '<script type="module">',
            'import { tome } from "/widgets/v1/tome.js";',
            'customElements.define("my-check", class extends HTMLElement {',
            "  connectedCallback() {",
            '    this.innerHTML = "<p class=\\"tome-answer\\">hello</p><button>Check</button>";',
            '    this.querySelector("button").addEventListener("click", () =>',
            '      tome.attempt({ ref: "item:hola", outcome: "correct", grade: 3 }, this).catch(() => {}));',
            "  }",
            "});",
            "</script>",
            "<my-check></my-check>",
          ].join("\n"),
        ),
    });
    const page = await open(LESSON);
    await app.stop();

    await page.getByRole("button", { name: "Check" }).click();

    const notice = page.locator('my-check > .tome-notice[data-state="unsaved"]');
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await page.locator("my-check .tome-answer").textContent()).toBe("hello");
    const css = await page.evaluate(() =>
      document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n"),
    );
    expect(css).toContain(".tome-notice");
    expect(css).toContain("@layer tome.widgets");
    const variables = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
    expect(variables.length).toBeGreaterThan(0);
    expect(variables.filter((name) => !name!.startsWith("--t-"))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  });
});
