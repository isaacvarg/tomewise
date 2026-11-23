import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

type Dashboard = Awaited<ReturnType<typeof startDashboard>>;
type Event = { id: string; kind: string; ref?: string; sessionId?: string; outcome?: string; subject: string };

async function addSubject(root: string, id: string, name: string, words: string[]) {
  const dir = join(root, "subjects", id);
  await mkdir(join(dir, "items"), { recursive: true });
  await writeFile(join(dir, "subject.json"), JSON.stringify({ name }));
  const items = words.map((word) => ({ id: word, type: "flashcard", front: word, back: word }));
  await writeFile(join(dir, "items/words.json"), JSON.stringify(items));
}

function twoDue(config: Record<string, unknown>, extra?: (root: string) => Promise<void>) {
  return async (root: string) => {
    await rm(join(root, "subjects/morse-code"), { recursive: true });
    await addSubject(root, "french", "French", ["bonjour", "merci"]);
    await extra?.(root);
    const file = join(root, "tomewise.json");
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), ...config }));
  };
}

const withGerman = (root: string) => addSubject(root, "german", "German", ["hallo"]);

async function open(width: Width, path: string, prepare: (root: string) => Promise<void>) {
  const dashboard = await startDashboard({ width, prepare });
  const before = new Map<string, Set<string>>();
  for (const subject of ["spanish", "french", "german"]) before.set(subject, await eventIds(dashboard, subject));
  const page = await dashboard.open(path);
  return { ...dashboard, page, before };
}

async function eventIds(dashboard: Dashboard, subject: string) {
  const { status, body } = await dashboard.app.get(`/api/subjects/${subject}/events`);
  return new Set(status === 200 ? (body.events as Event[]).map((event) => event.id) : []);
}

async function newEvents(dashboard: Dashboard & { before: Map<string, Set<string>> }, subject: string) {
  const { body } = await dashboard.app.get(`/api/subjects/${subject}/events`);
  return (body.events as Event[]).filter((event) => !dashboard.before.get(subject)!.has(event.id));
}

const kinds = async (dashboard: Parameters<typeof newEvents>[0], subject: string) =>
  (await newEvents(dashboard, subject)).map((event) => event.kind);

const texts = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));

async function runFlashcards(page: Page, subject: string, grades: number[], total = grades.length) {
  const runner = page.locator(".tome-runner");
  await expect.poll(() => runner.locator(".tome-drill .tome-kicker").first().textContent()).toBe(subject);
  for (const [index, grade] of grades.entries()) {
    await expect.poll(() => runner.locator(".tome-count").textContent()).toBe(`${index + 1} / ${total}`);
    await runner.locator(".tome-reveal").click();
    await runner.locator(`.tome-grade[data-grade="${grade}"]`).click();
    await runner.locator(".tome-next").click();
  }
}

async function breakScreen(page: Page): Promise<Locator> {
  const screen = page.locator(".tome-break");
  await expect.poll(() => screen.count()).toBe(1);
  return screen;
}

async function combinedSummary(page: Page) {
  const runner = page.locator(".tome-runner");
  await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
  return runner.locator(".tome-runner-summary");
}

const ended = (events: Event[]) => events.filter((event) => event.kind === "session.end").length;

describe.each(["phone", "desktop"] as const)("Start in sequence mode at %s width", (width) => {
  it("runs each subject with due items in saved order, one session each, with a break between", async () => {
    const dashboard = await open(width, "/", twoDue({ subjects: ["spanish", "french"] }));
    const { page, pageErrors } = dashboard;

    await page.locator(".tome-start").click();
    await page.waitForURL(/\/run\/due$/);
    await runFlashcards(page, "Spanish", [1, 3, 3, 3]);

    const screen = await breakScreen(page);
    expect(await screen.locator(".tome-kicker").innerText()).toBe("Spanish");
    expect(await screen.locator(".tome-score").innerText()).toBe("75%");
    expect(await screen.locator(".tome-score-sub").innerText()).toBe("3 of 4 right");
    expect(await screen.locator(".tome-break-next").innerText()).toBe("Next: French, 2 items");
    expect(await texts(page, ".tome-break .tome-actions button")).toEqual(["Continue", "Skip", "Done"]);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Continue");
    const used = await page
      .locator(".tome-runner, .tome-runner *")
      .evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))))]);
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);

    await screen.locator(".tome-break-continue").click();
    await runFlashcards(page, "French", [3, 3]);

    const summary = await combinedSummary(page);
    expect(await summary.locator(".tome-kicker").innerText()).toBe("All done");
    expect(await summary.locator(".tome-score-sub").innerText()).toBe("5 of 6 right");
    expect(await texts(page, ".tome-runner-summary .tome-stats li")).toEqual(
      expect.arrayContaining(["Spanish\n3 of 4", "French\n2 of 2"]),
    );
    expect(await texts(page, ".tome-look-again .tome-look-item")).toEqual(["hola"]);

    await expect.poll(async () => ended(await newEvents(dashboard, "french"))).toBe(1);
    const spanish = await newEvents(dashboard, "spanish");
    const french = await newEvents(dashboard, "french");
    expect(spanish.map((event) => event.kind)).toEqual(["session.start", ...Array(4).fill("attempt"), "session.end"]);
    expect(french.map((event) => event.kind)).toEqual(["session.start", "attempt", "attempt", "session.end"]);
    expect([spanish[0]!.ref, french[0]!.ref]).toEqual(["drill:review", "drill:review"]);
    expect(spanish.every((event) => event.sessionId === spanish[0]!.id)).toBe(true);
    expect(french.every((event) => event.sessionId === french[0]!.id)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 40_000);
});

describe("Start in sequence mode", () => {
  it("is the default and runs subjects in name order when none is saved", async () => {
    const dashboard = await open("phone", "/run/due", twoDue({}));
    await runFlashcards(dashboard.page, "French", [3, 3]);
    expect(await (await breakScreen(dashboard.page)).locator(".tome-break-next").innerText()).toBe("Next: Spanish, 4 items");
  });

  it("skips to the subject after next, and runs only the ones not skipped", async () => {
    const dashboard = await open("phone", "/run/due", twoDue({ subjects: ["spanish", "french", "german"] }, withGerman));
    const { page } = dashboard;
    await runFlashcards(page, "Spanish", [3, 3, 3, 3]);

    const screen = await breakScreen(page);
    await screen.locator(".tome-break-skip").click();
    await expect.poll(() => screen.locator(".tome-break-next").innerText()).toBe("Next: German, 1 item");
    expect(await screen.locator(".tome-kicker").innerText()).toBe("Spanish");
    await screen.locator(".tome-break-continue").click();
    await runFlashcards(page, "German", [3]);

    const summary = await combinedSummary(page);
    expect(await summary.locator(".tome-score-sub").innerText()).toBe("5 of 5 right");
    await expect.poll(async () => ended(await newEvents(dashboard, "german"))).toBe(1);
    expect(await kinds(dashboard, "french")).toEqual([]);
    expect(ended(await newEvents(dashboard, "spanish"))).toBe(1);
  }, 30_000);

  it("ends with the combined summary when the last subject is skipped", async () => {
    const dashboard = await open("phone", "/run/due", twoDue({ subjects: ["spanish", "french"] }));
    await runFlashcards(dashboard.page, "Spanish", [3, 3, 3, 1]);

    await (await breakScreen(dashboard.page)).locator(".tome-break-skip").click();

    const summary = await combinedSummary(dashboard.page);
    expect(await summary.locator(".tome-score-sub").innerText()).toBe("3 of 4 right");
    expect(await kinds(dashboard, "french")).toEqual([]);
  }, 30_000);

  it("ends with the combined summary on Done", async () => {
    const dashboard = await open("phone", "/run/due", twoDue({ subjects: ["spanish", "french"] }));
    const { page } = dashboard;
    await runFlashcards(page, "Spanish", [3, 1, 3, 3]);

    await (await breakScreen(page)).locator(".tome-break-done").click();

    const summary = await combinedSummary(page);
    expect(await summary.locator(".tome-score-sub").innerText()).toBe("3 of 4 right");
    expect(await texts(page, ".tome-look-again .tome-look-item")).toEqual(["adiós"]);
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("tome-back");
    expect(await kinds(dashboard, "french")).toEqual([]);
  }, 30_000);

  it("keeps running when the start setting changes mid-run", async () => {
    const dashboard = await open("phone", "/run/due", twoDue({ subjects: ["spanish", "french"] }));
    const { page, app } = dashboard;
    await runFlashcards(page, "Spanish", [3, 3], 4);

    await page.evaluate(() =>
      fetch("/api/settings/start", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "ask" }) }),
    );
    expect((await app.get("/api/settings")).body.start).toBe("ask");
    await page.waitForTimeout(300);

    expect(await page.locator(".tome-pick").count()).toBe(0);
    expect(await page.locator(".tome-count").textContent()).toBe("3 / 4");
  }, 30_000);

  it("says so when nothing is due", async () => {
    const dashboard = await open("phone", "/run/due", async (root) => {
      await rm(join(root, "subjects"), { recursive: true });
      await addSubject(root, "french", "French", []);
    });
    const runner = dashboard.page.locator(".tome-runner");
    await expect.poll(() => runner.getAttribute("data-state")).toBe("empty");
    expect(await texts(dashboard.page, ".tome-runner .tome-hint")).toEqual(["Nothing due today."]);
    expect(await runner.locator(".tome-back").getAttribute("href")).toBe("/");
  });
});

describe.each(["phone", "desktop"] as const)("Start in ask mode at %s width", (width) => {
  it("lists subjects with due counts and times under 'All, one after another', and runs only the one picked", async () => {
    const dashboard = await open(width, "/", twoDue({ start: "ask", subjects: ["spanish", "french"] }));
    const { page, pageErrors } = dashboard;

    await page.locator(".tome-start").click();
    await page.waitForURL(/\/run\/due$/);
    const picks = page.locator(".tome-pick");
    await expect.poll(() => picks.count()).toBe(3);
    expect(await texts(page, ".tome-pick")).toEqual([
      "All, one after another\n6 items · 5 min",
      "Spanish\n4 items · 3 min",
      "French\n2 items · 2 min",
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await picks.nth(2).click();
    await page.waitForURL(/\/run\/due\?subject=french$/);
    await runFlashcards(page, "French", [3, 3]);
    await expect.poll(() => page.locator(".tome-runner").getAttribute("data-state")).toBe("done");
    expect(await page.locator(".tome-break").count()).toBe(0);
    await expect.poll(async () => ended(await newEvents(dashboard, "french"))).toBe(1);
    expect(await kinds(dashboard, "spanish")).toEqual([]);
    expect(pageErrors).toEqual([]);
  }, 30_000);
});

describe("Start in ask mode", () => {
  it("runs the sequence from 'All, one after another'", async () => {
    const dashboard = await open("phone", "/run/due", twoDue({ start: "ask", subjects: ["spanish", "french"] }));
    const { page } = dashboard;

    await page.locator(".tome-pick").first().click();
    await page.waitForURL(/\/run\/due\?all$/);
    await runFlashcards(page, "Spanish", [3, 3, 3, 3]);
    expect(await (await breakScreen(page)).locator(".tome-break-next").innerText()).toBe("Next: French, 2 items");
  }, 30_000);
});
