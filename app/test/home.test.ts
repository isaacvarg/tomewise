import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

const SECTIONS = ["tome-header", "tome-activity", "tome-subjects", "tome-due", "tome-streak", "tome-start"];

async function openHome(width: Width = "phone", prepare?: (root: string) => Promise<void>) {
  const dashboard = await startDashboard({ width, prepare });
  const page = await dashboard.open("/");
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  return { ...dashboard, page };
}

const texts = (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));

const tops = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));

const visibleCells = (page: Page) =>
  page.locator(".tome-heatmap .tome-cell").evaluateAll((cells) => cells.filter((cell) => getComputedStyle(cell).display !== "none").length);

describe("the dashboard SPA", () => {
  it("serves the home page at / in the learner's theme", async () => {
    const { page, pageErrors } = await openHome();

    expect(await page.locator('meta[name="tome-theme"]').getAttribute("content")).toBe("paper");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".tome-start")!).backgroundColor)).toBe("rgb(154, 59, 30)");
    expect(pageErrors).toEqual([]);
  });

  it.each([
    ["/s/morse-code", "MMorse code"],
    ["/run", "No drill chosen"],
    ["/settings", "Settings"],
    ["/no/such/page", "Not found"],
  ])("renders %s in the SPA, not a server 404", async (path, heading) => {
    const { open, pageErrors } = await startDashboard();

    const page = await open(path);

    await expect.poll(() => page.locator(".tome-title").textContent()).toBe(heading);
    expect(pageErrors).toEqual([]);
  });

  it("uses only the theme contract's dashboard classes", async () => {
    const { page } = await openHome("desktop");

    const used = await page
      .locator(".tome-app, .tome-app *")
      .evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))))]);
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);
  });

  it("starts what's due at /run/due without reloading the page", async () => {
    const { page } = await openHome();
    await page.evaluate(() => ((window as any).sameDocument = true));

    await page.locator(".tome-start").click();

    await page.waitForURL(/\/run\/due$/);
    expect(await page.evaluate(() => (window as any).sameDocument)).toBe(true);
  });
});

describe.each(["phone", "desktop"] as const)("home at %s width", (width) => {
  it("keeps the mockup's order: heatmap, subjects, due today, streak, Start", async () => {
    const { page } = await openHome(width);

    const order = await page.locator(".tome-app > *").evaluateAll((els, names) =>
      els.map((el) => names.find((name) => el.classList.contains(name))),
    SECTIONS);
    expect(order).toEqual(SECTIONS);
  });

  it("dates the page with the learning home's today", async () => {
    const { page } = await openHome(width);

    expect(await texts(page, ".tome-kicker")).toEqual(["Saturday 21 November"]);
    expect(await texts(page, ".tome-title")).toEqual(["Today"]);
  });

  it("draws the fixture's activity, weeks Monday to Sunday", async () => {
    const { page } = await openHome(width);

    const cells = page.locator(".tome-heatmap .tome-cell");
    expect(await cells.count()).toBe(52 * 7);
    expect(await page.locator(".tome-heatmap [data-today]").getAttribute("data-date")).toBe("2026-11-21");
    expect(await cells.last().getAttribute("data-date")).toBe("2026-11-22");
    expect(await cells.last().getAttribute("data-future")).toBe("");
    expect(await cells.first().getAttribute("data-date")).toBe("2025-11-24");
    const levels = await page
      .locator(".tome-heatmap [data-level]")
      .evaluateAll((els) => Object.fromEntries(els.map((el) => [el.getAttribute("data-date"), el.getAttribute("data-level")])));
    expect(levels).toEqual({
      "2026-10-30": "2",
      "2026-11-02": "2",
      "2026-11-05": "2",
      "2026-11-08": "3",
      "2026-11-20": "2",
      "2026-11-21": "2",
    });
    expect(await texts(page, ".tome-heat-days span")).toEqual(["M", "", "W", "", "F", "", "S"]);
    if (width === "phone") {
      expect(await visibleCells(page)).toBe(18 * 7);
      expect(await page.locator(".tome-activity .tome-meta").innerText()).toBe("Last 18 weeks");
    } else {
      expect(await visibleCells(page)).toBe(52 * 7);
      expect(await page.locator(".tome-activity .tome-meta").innerText()).toBe("Last 12 months");
    }
  });

  it("shows the subjects alphabetically, linking to each subject home, with no progress", async () => {
    const { page } = await openHome(width);

    expect(await texts(page, ".tome-subject-name")).toEqual(["Morse code", "Spanish", "Yoga"]);
    expect(await page.locator(".tome-subject").evaluateAll((els) => els.map((el) => el.getAttribute("href")))).toEqual([
      "/s/morse-code",
      "/s/spanish",
      "/s/yoga",
    ]);
    expect(await texts(page, ".tome-subject")).toEqual(["M\nMorse code", "S\nSpanish", "Y\nYoga"]);
    const [first, second, third] = await tops(page, ".tome-subject");
    expect(second).toBe(first);
    if (width === "phone") expect(third).toBeGreaterThan(first!);
    else expect(third).toBe(first);
  });

  it("lists what's due today with the item count and time for each subject", async () => {
    const { page } = await openHome(width);

    expect(await texts(page, ".tome-due .tome-meta")).toEqual(["7 items"]);
    expect(await texts(page, ".tome-due li")).toEqual(["Morse code\n3 items · 2 min", "Spanish\n4 items · 3 min"]);
  });

  it("shows the streak and the rest days left this week", async () => {
    const { page } = await openHome(width);

    expect(await texts(page, ".tome-streak-num")).toEqual(["2"]);
    expect(await texts(page, ".tome-streak-text")).toEqual(["day streak · 1 rest day left this week"]);
  });

  it("offers one Start for everything due, linking to /run/due", async () => {
    const { page } = await openHome(width);

    const start = page.locator(".tome-start");
    expect(await start.count()).toBe(1);
    expect(await start.innerText()).toMatch(/^Start\s+7 items, about 5 min$/);
    expect(await start.getAttribute("href")).toBe("/run/due");
  });

  it("puts due today and the streak side by side only on wide screens", async () => {
    const { page } = await openHome(width);

    const [due] = await tops(page, ".tome-due");
    const [streak] = await tops(page, ".tome-streak");
    if (width === "phone") expect(streak).toBeGreaterThan(due!);
    else expect(streak).toBe(due);
  });

  it("doesn't scroll sideways", async () => {
    const { page } = await openHome(width);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

describe("home with nothing to do", () => {
  const onlyYoga = async (root: string) => {
    await rm(join(root, "subjects/morse-code"), { recursive: true });
    await rm(join(root, "subjects/spanish"), { recursive: true });
  };

  it("says nothing is due and has nothing to start", async () => {
    const { page } = await openHome("phone", onlyYoga);

    expect(await texts(page, ".tome-due .tome-meta")).toEqual(["0 items"]);
    expect(await texts(page, ".tome-due .tome-hint")).toEqual(["Nothing due today."]);
    expect(await page.locator(".tome-start").innerText()).toMatch(/^Start\s+nothing due$/);
    expect(await page.locator(".tome-start").getAttribute("href")).toBeNull();
    expect(await page.locator(".tome-start").getAttribute("aria-disabled")).toBe("true");
  });

  it("shows a streak of zero and no active days", async () => {
    const { page } = await openHome("phone", onlyYoga);

    expect(await texts(page, ".tome-streak-num")).toEqual(["0"]);
    expect(await page.locator(".tome-heatmap [data-level]").count()).toBe(0);
  });

  it("says when no rest days are left this week", async () => {
    const { page } = await openHome("phone", async (root) => {
      await onlyYoga(root);
      await writeFile(join(root, "tomewise.json"), JSON.stringify({ formatVersion: 1, timezone: "Europe/London", weekStart: "monday" }));
    });

    expect(await texts(page, ".tome-streak-text")).toEqual(["day streak · no rest days left this week"]);
  });
});
