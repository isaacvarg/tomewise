import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

const MORSE = "subjects/morse-code";
const SESSION = "01KAZ0000000000000000G001S";

async function write(root: string, files: Record<string, unknown>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  }
}

const lines = (events: object[]) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";

async function morseInAuckland(root: string, theme?: string) {
  const config = JSON.parse(await readFile(join(root, "tomewise.json"), "utf8"));
  await write(root, {
    "tomewise.json": { ...config, timezone: "Pacific/Auckland", ...(theme && { theme }) },
    [`${MORSE}/items/0000-start.json`]: [
      { id: "letter-e", type: "timed-audio", prompt: "E", answer: "E" },
      { id: "letter-t", type: "timed-audio", audio: "assets/audio/k.wav", answer: "T", unlockedBy: "0001-k-and-m", retired: true },
    ],
    [`${MORSE}/events/2026-11.glossary.jsonl`]: lines([
      { id: SESSION, ts: "2026-11-21T08:00:00.000Z", subject: "morse-code", kind: "session.start", ref: "drill:review", sessionId: SESSION, schemaVersion: 2, data: {} },
      {
        id: "01KAZ0000000000000000G001A",
        ts: "2026-11-21T08:00:05.000Z",
        subject: "morse-code",
        kind: "attempt",
        ref: "item:letter-m",
        sessionId: SESSION,
        outcome: "correct",
        grade: 3,
        schemaVersion: 2,
        data: { heard: "M", answer: "M", responseTime: 900, wpm: 20 },
      },
    ]),
  });
}

async function openGlossary(width: Width = "phone", prepare: (root: string) => Promise<void> = (root) => morseInAuckland(root)) {
  const dashboard = await startDashboard({ width, prepare });
  await dashboard.page.addInitScript(() => {
    const played: string[] = [];
    (window as any).played = played;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      played.push(new URL(this.src).pathname);
      return play.call(this);
    };
  });
  const page = await dashboard.open("/s/morse-code/glossary");
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  return { ...dashboard, page };
}

const texts = (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));

describe("glossary", () => {
  it("lists unlocked, unretired items under the lesson that unlocked them, in curriculum order", async () => {
    const { page, pageErrors } = await openGlossary();

    expect(await texts(page, ".tome-kicker")).toEqual(["Morse code"]);
    expect(await texts(page, ".tome-title")).toEqual(["Glossary"]);
    expect(await texts(page, ".tome-lede")).toEqual(["4 items from 2 lessons"]);
    expect(await texts(page, ".tome-glossary h3")).toEqual(["From the start", "1K and m", "2R"]);
    expect(await texts(page, ".tome-glossary .tome-meta")).toEqual(["1 item", "2 items", "1 item"]);
    expect(await texts(page, ".tome-term-word")).toEqual(["E", "K", "M", "R"]);
    expect(pageErrors).toEqual([]);
  });

  it("says when each item is next due, counting days in the home's timezone", async () => {
    const { page } = await openGlossary();

    expect(await texts(page, ".tome-term-when")).toEqual(["due today", "due today", "in 5 days", "due today"]);
    expect(await page.locator(".tome-term-when[data-due]").count()).toBe(3);
  });

  it("links each lesson heading to its lesson", async () => {
    const { page } = await openGlossary();

    await page.locator('[data-lesson="0002-r"] h3 a').click();

    await page.waitForURL(/\/s\/morse-code\/lessons\/0002-r\.html$/);
  });

  it("plays an audio item's sound, and gives no play button to an item without one", async () => {
    const { page, pageErrors } = await openGlossary();

    expect(await page.locator('[data-item="letter-e"] .tome-hear').count()).toBe(0);
    const hear = page.locator('[data-item="letter-k"] .tome-hear');
    expect(await hear.getAttribute("aria-label")).toBe("Hear K");
    await hear.click();

    expect(await page.evaluate(() => (window as any).played)).toEqual(["/s/morse-code/assets/audio/k.wav"]);
    await page.locator('[data-item="letter-k"] .tome-hear[data-playing]').waitFor();
    await page.locator('[data-item="letter-k"] .tome-hear:not([data-playing])').waitFor();
    expect(await page.locator(".tome-notice").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it("plays only the last sound asked for, without an error, when two are tapped at once", async () => {
    const { page } = await openGlossary();

    await page.evaluate(() => {
      const seen = ((window as any).notices = [] as string[]);
      new MutationObserver(() => document.querySelectorAll(".tome-notice").forEach((el) => seen.push(el.textContent!))).observe(document.body, {
        childList: true,
        subtree: true,
      });
      (document.querySelector('[data-item="letter-k"] .tome-hear') as HTMLElement).click();
      (document.querySelector('[data-item="letter-m"] .tome-hear') as HTMLElement).click();
    });

    await page.waitForFunction(() => (window as any).played.length === 2);
    await page.locator(".tome-hear[data-playing]").waitFor({ state: "detached" });
    expect(await page.evaluate(() => (window as any).played)).toEqual(["/s/morse-code/assets/audio/k.wav", "/s/morse-code/assets/audio/m.wav"]);
    expect(await page.evaluate(() => (window as any).notices)).toEqual([]);
    expect(await page.locator('[data-item="letter-k"] .tome-hear[data-playing]').count()).toBe(0);
  });

  it("says so when the sound can't be played", async () => {
    const { page } = await openGlossary("phone", async (root) => {
      await morseInAuckland(root);
      await write(root, { [`${MORSE}/assets/audio/r.wav`]: "not a sound" });
    });

    await page.locator('[data-item="letter-r"] .tome-hear').click();

    await page.locator(".tome-notice").waitFor();
    expect(await page.locator(".tome-notice").innerText()).toMatch(/^Couldn't play the sound/);
    expect(await page.locator(".tome-hear[data-playing]").count()).toBe(0);
  });

  it("says so when nothing is unlocked", async () => {
    const { page } = await openGlossary("phone", async (root) => {
      await write(root, { [`${MORSE}/events/2026-10.jsonl`]: "", [`${MORSE}/events/2026-11.jsonl`]: "", [`${MORSE}/events/2026-11.laptop.jsonl`]: "" });
    });

    expect(await texts(page, ".tome-lede")).toEqual(["0 items from 0 lessons"]);
    expect(await texts(page, ".tome-glossary .tome-hint")).toEqual(["Nothing unlocked yet. Finish a lesson to fill your glossary."]);
  });

  it("links back to the subject's Reference tab", async () => {
    const { page } = await openGlossary();

    await page.locator(".tome-home-link").click();

    await page.waitForURL(/\/s\/morse-code\/reference$/);
    expect(await page.locator('.tome-tab[aria-selected="true"]').innerText()).toBe("Reference");
  });

  it("is served by the dashboard, not as a subject page", async () => {
    const { app } = await openGlossary();

    const response = await fetch(`${app.url}/s/morse-code/glossary`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });
});

describe("glossary layout", () => {
  it("puts terms two across on a phone, without scrolling sideways", async () => {
    const { page } = await openGlossary("phone");

    const tops = await page.locator('[data-lesson="0001-k-and-m"] .tome-term').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect(tops[1]).toBe(tops[0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  it("puts lessons two across on wide screens", async () => {
    const { page } = await openGlossary("desktop");

    const tops = await page.locator(".tome-glossary > .tome-section").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect(tops[1]).toBe(tops[0]);
    expect(tops[2]).toBeGreaterThan(tops[0]!);
  });

  it("uses only the theme contract's dashboard classes", async () => {
    const { page } = await openGlossary("desktop");

    const used = await page
      .locator(".tome-app, .tome-app *")
      .evaluateAll((els) => els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))));
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);
  });

  it.each([
    ["paper", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"],
    ["meadow", "rgb(255, 255, 255)", "rgb(67, 122, 38)"],
  ])("styles terms and play buttons in %s", async (theme, term, hear) => {
    const { page } = await openGlossary("phone", (root) => morseInAuckland(root, theme));

    const style = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await style(".tome-term")).toBe(term);
    expect(await style(".tome-hear")).toBe(hear);
  });
});
