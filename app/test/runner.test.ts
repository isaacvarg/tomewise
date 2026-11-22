import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

type Dashboard = Awaited<ReturnType<typeof startDashboard>>;
type Event = { id: string; kind: string; ref?: string; sessionId?: string; outcome?: string; grade?: number; duration?: number; subject: string };

const MORSE_ITEMS = "subjects/morse-code/items";

async function wpmOptional(root: string) {
  const file = join(root, "subjects/morse-code/subject.json");
  const subject = JSON.parse(await readFile(file, "utf8"));
  const latest = subject.payloadSchemas.at(-1);
  const attempt = latest.kinds.attempt;
  subject.payloadSchemas.push({
    version: latest.version + 1,
    kinds: { attempt: { ...attempt, required: attempt.required.filter((name: string) => name !== "wpm") } },
  });
  await writeFile(file, JSON.stringify(subject));
}

async function quickLetterR(root: string) {
  await wpmOptional(root);
  const file = join(root, MORSE_ITEMS, "0002-r.json");
  const items = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>[];
  await writeFile(file, JSON.stringify(items.map((item) => (item.id === "letter-r" ? { ...item, timeLimitSeconds: 0.5 } : item))));
}

async function newEvents(dashboard: Dashboard, subject: string, before: Set<string>, done: (events: Event[]) => boolean) {
  let latest: Event[] = [];
  await expect
    .poll(
      async () => {
        const { body } = await dashboard.app.get(`/api/subjects/${subject}/events`);
        latest = (body.events as Event[]).filter((event) => !before.has(event.id));
        return done(latest);
      },
      { timeout: 5000, interval: 50 },
    )
    .toBe(true);
  return latest;
}

async function eventIds(dashboard: Dashboard, subject: string) {
  const { body } = await dashboard.app.get(`/api/subjects/${subject}/events`);
  return new Set((body.events as Event[]).map((event) => event.id));
}

const ended = (events: Event[]) => events.some((event) => event.kind === "session.end");
const texts = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));

async function shortListenDrill(root: string) {
  await wpmOptional(root);
  const file = join(root, "subjects/morse-code/drills/listen-kmrsu.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), count: 2 }));
}

async function openRun(width: Width, path: string, prepare?: (root: string) => Promise<void>, touch = false) {
  const dashboard = await startDashboard({ width, prepare, touch });
  const page = await dashboard.open(path);
  const runner = page.locator(".tome-runner");
  await expect.poll(() => runner.getAttribute("data-state")).not.toBe("loading");
  return { ...dashboard, page, runner };
}

async function waitForItem(runner: Locator, index: number, total: number) {
  await expect.poll(() => runner.locator(".tome-count").textContent()).toBe(`${index} / ${total}`);
}

function clock(ms: number) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

describe.each(["phone", "desktop"] as const)("the runner at %s width", (width) => {
  it("runs due Morse items at /run/due?subject=morse-code and writes attempts and session.end", async () => {
    const dashboard = await openRun(width, "/run/due?subject=morse-code", quickLetterR);
    const { page, runner, pageErrors } = dashboard;
    const before = await eventIds(dashboard, "morse-code");

    await expect.poll(() => runner.locator(".tome-drill-name").textContent()).toBe("Review everything due");
    expect(await runner.locator(".tome-kicker").first().textContent()).toBe("Morse code");
    expect(await runner.locator(".tome-close").getAttribute("aria-label")).toBe("End session");

    const answers = ["K", undefined, "K"];
    for (const [index, answer] of answers.entries()) {
      await waitForItem(runner, index + 1, 3);
      const audio = runner.locator("tome-audio");
      await audio.locator(".tome-play").click();
      if (answer) {
        const input = audio.locator(".tome-input");
        await expect.poll(() => input.isEnabled()).toBe(true);
        await input.fill(answer);
        await input.press("Enter");
      }
      await runner.locator(".tome-next").click();
    }

    await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
    const events = await newEvents(dashboard, "morse-code", before, ended);
    expect(events.map((event) => event.kind)).toEqual(["session.start", "attempt", "attempt", "attempt", "session.end"]);
    const [start, ...rest] = events;
    expect(start!.ref).toBe("drill:review");
    expect(rest.map((event) => event.sessionId)).toEqual(Array(4).fill(start!.id));
    expect(rest.slice(0, 3).map((event) => [event.ref, event.outcome, event.grade])).toEqual([
      ["item:letter-m", "wrong", 1],
      ["item:letter-r", "skipped", 1],
      ["item:letter-k", "correct", 3],
    ]);

    const summary = runner.locator(".tome-runner-summary");
    expect(await summary.locator(".tome-score").textContent()).toBe("33%");
    expect(await summary.locator(".tome-score-sub").textContent()).toBe("1 of 3 right");
    expect(await texts(page, ".tome-runner-summary .tome-stats li")).toEqual([`Time\n${clock(events.at(-1)!.duration!)}`]);
    expect(await texts(page, ".tome-look-again li")).toEqual(["M\nWrong\nLesson 1: k and m", "R\nNo answer\nLesson 2: r"]);
    expect(await page.locator(".tome-look-again a").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual([
      "/s/morse-code/lessons/0001-k-and-m.html",
      "/s/morse-code/lessons/0002-r.html",
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 30_000);

  it("runs a named drill at /run?drill=listen-kmrsu by touch", async () => {
    const dashboard = await openRun(width, "/run?drill=listen-kmrsu", shortListenDrill, true);
    const { runner, page } = dashboard;
    const before = await eventIds(dashboard, "morse-code");
    await expect.poll(() => runner.locator(".tome-drill-name").textContent()).toBe("Listen · K M R S U");

    const refs: string[] = [];
    for (let index = 0; index < 2; index++) {
      await waitForItem(runner, index + 1, 2);
      const audio = runner.locator("tome-audio");
      refs.push((await audio.getAttribute("ref"))!);
      if (index === 0) await audio.locator(".tome-play").tap();
      const letter = refs.at(-1)!.replace("item:letter-", "").toUpperCase();
      const answer = audio.locator(`.tome-answer[data-choice="${letter}"]`);
      await expect.poll(() => answer.isEnabled()).toBe(true);
      await answer.tap();
      await runner.locator(".tome-next").tap();
    }

    await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
    expect(await runner.locator(".tome-score").textContent()).toBe("100%");
    expect(await texts(page, ".tome-look-again .tome-hint")).toEqual(["Nothing to look at again."]);
    const events = await newEvents(dashboard, "morse-code", before, ended);
    expect(events.map((event) => event.kind)).toEqual(["session.start", "attempt", "attempt", "session.end"]);
    expect(events[0]!.ref).toBe("drill:listen-kmrsu");
    expect(events.filter((event) => event.kind === "attempt").map((event) => event.ref)).toEqual(refs);

    await runner.locator(".tome-again").tap();
    await waitForItem(runner, 1, 2);
    expect(await runner.locator(".tome-runner-summary").count()).toBe(0);
  }, 30_000);

  it("runs by keyboard alone, from the first item to the summary", async () => {
    const dashboard = await openRun(width, "/run/due?subject=morse-code", quickLetterR);
    const { page, runner } = dashboard;
    const before = await eventIds(dashboard, "morse-code");
    const focused = () => page.evaluate(() => document.activeElement?.className ?? "");

    for (const [index, answer] of ["M", undefined, "K"].entries()) {
      await waitForItem(runner, index + 1, 3);
      await expect.poll(focused).toBe("tome-play");
      await page.keyboard.press("Space");
      if (answer) {
        await expect.poll(focused).toBe("tome-input");
        await page.keyboard.type(answer);
        await page.keyboard.press("Enter");
      }
      await expect.poll(focused, { timeout: 5000 }).toBe("tome-next");
      await page.keyboard.press("Enter");
    }

    await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
    expect(await runner.locator(".tome-score-sub").textContent()).toBe("2 of 3 right");
    expect(await focused()).toBe("tome-back");
    const events = await newEvents(dashboard, "morse-code", before, ended);
    expect(events.filter((event) => event.kind === "attempt").map((event) => event.outcome)).toEqual(["correct", "skipped", "correct"]);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/$/);
  }, 30_000);

  it("ends the session when closed mid-run", async () => {
    const dashboard = await openRun(width, "/run/due?subject=morse-code", wpmOptional);
    const { page, runner } = dashboard;
    const before = await eventIds(dashboard, "morse-code");
    await waitForItem(runner, 1, 3);
    const audio = runner.locator("tome-audio");
    await audio.locator(".tome-play").click();
    const input = audio.locator(".tome-input");
    await expect.poll(() => input.isEnabled()).toBe(true);
    await input.fill("M");
    await input.press("Enter");
    await newEvents(dashboard, "morse-code", before, (events) => events.some((event) => event.kind === "attempt"));

    await runner.locator(".tome-close").click();

    await page.waitForURL(/\/$/);
    const events = await newEvents(dashboard, "morse-code", before, ended);
    expect(events.map((event) => event.kind)).toEqual(["session.start", "attempt", "session.end"]);
    expect(events[2]).toMatchObject({ ref: "drill:review", sessionId: events[0]!.id });
    expect(events[2]!.duration).toBeGreaterThan(0);
  });

  it("keeps one centred column and only the theme contract's classes", async () => {
    const { page, runner } = await openRun(width, "/run/due?subject=morse-code");
    await waitForItem(runner, 1, 3);

    const box = (await runner.locator("tome-drill").boundingBox())!;
    const viewport = page.viewportSize()!;
    if (width === "phone") expect(box.width).toBe(viewport.width);
    else {
      expect(box.width).toBeLessThanOrEqual(36 * 16);
      expect(Math.abs(box.x - (viewport.width - box.x - box.width))).toBeLessThanOrEqual(1);
    }
    const used = await page
      .locator(".tome-runner, .tome-runner *:not(tome-drill, tome-drill *)")
      .evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))))]);
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

describe("the runner", () => {
  it("runs one subject after another in the same page, each in its own session", async () => {
    const dashboard = await openRun("phone", "/run/due?subject=spanish", wpmOptional);
    const { page, runner } = dashboard;
    const spanishBefore = await eventIds(dashboard, "spanish");
    const morseBefore = await eventIds(dashboard, "morse-code");
    await page.evaluate(() => ((window as any).samePage = true));

    for (let index = 0; index < 4; index++) {
      await waitForItem(runner, index + 1, 4);
      await runner.locator(".tome-reveal").click();
      await runner.locator(`.tome-grade[data-grade="${index === 0 ? 1 : 3}"]`).click();
      await runner.locator(".tome-next").click();
    }
    await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
    expect(await texts(page, ".tome-look-again li")).toEqual(["hola\nAgain"]);

    await page.evaluate(() => {
      history.pushState(null, "", "/run/due?subject=morse-code");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect.poll(() => runner.locator(".tome-kicker").first().textContent()).toBe("Morse code");
    await waitForItem(runner, 1, 3);
    const audio = runner.locator("tome-audio");
    await audio.locator(".tome-play").click();
    const input = audio.locator(".tome-input");
    await expect.poll(() => input.isEnabled()).toBe(true);
    await input.fill("M");
    await input.press("Enter");
    await runner.locator(".tome-close").click();

    const spanish = await newEvents(dashboard, "spanish", spanishBefore, ended);
    const morse = await newEvents(dashboard, "morse-code", morseBefore, ended);
    expect(spanish.map((event) => event.kind)).toEqual(["session.start", ...Array(4).fill("attempt"), "session.end"]);
    expect(morse.map((event) => event.kind)).toEqual(["session.start", "attempt", "session.end"]);
    expect(new Set([...spanish, ...morse].map((event) => event.subject))).toEqual(new Set(["spanish", "morse-code"]));
    expect(morse.every((event) => event.sessionId === morse[0]!.id)).toBe(true);
    expect(await page.evaluate(() => (window as any).samePage)).toBe(true);
  }, 30_000);

  it.each([
    ["/run/due?subject=nope", 'No subject "nope"'],
    ["/run?drill=nope", 'No subject has a drill "nope".'],
    ["/run?drill=review", 'Several subjects have a drill "review" (morse-code, spanish, yoga); add &subject= to the address to pick one.'],
    ["/run?drill=nope&subject=spanish", 'No drill "nope" in Spanish. Drills: review.'],
  ])("explains what's wrong at %s", async (path, message) => {
    const { page, runner } = await openRun("phone", path);

    expect(await runner.getAttribute("data-state")).toBe("error");
    expect(await page.locator(".tome-notice").textContent()).toContain(message);
    expect(await page.locator(".tome-back").getAttribute("href")).toBe("/");
  });
});
