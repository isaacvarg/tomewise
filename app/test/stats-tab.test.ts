import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { startDashboard, type Width } from "./browser.ts";
import { CHARTS, withFixture } from "./stats-fixture.ts";

const ACCURACY = { id: "accuracy", title: "Accuracy", kind: "line", measure: "accuracy", days: 30 };
const EMPTY = { id: "wpm", title: "Speed", kind: "line", measure: "payload", field: "wpm", days: 1, items: { drill: "listen-kmrsu" } };

async function openStats(charts: unknown[], width: Width = "phone") {
  const dashboard = await startDashboard({ width, prepare: (root) => withFixture(root, charts) });
  const page = await dashboard.open("/s/morse-code/stats");
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  await page.locator('[data-view="stats"] .tome-totals').waitFor();
  return { ...dashboard, page };
}

const texts = (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));

const marks = (page: Page, chart: string) =>
  page
    .locator(`.tome-chart[data-chart="${chart}"] :is(.tome-chart-dot, .tome-chart-bar)`)
    .evaluateAll((els) => els.map((el) => [el.getAttribute("data-date"), Number(el.getAttribute("data-value"))]));

describe("Stats tab", () => {
  it("shows totals: all time practised, sessions, and accuracy over the last 30 days", async () => {
    const { page, pageErrors } = await openStats(CHARTS);

    expect(await texts(page, ".tome-totals b")).toEqual(["35m", "3", "75%"]);
    expect(await texts(page, ".tome-totals span")).toEqual(["practised", "sessions", "accuracy, 30 days"]);
    expect(pageErrors).toEqual([]);
  });

  it("draws a line chart's days with data as its series, in the payload field's unit", async () => {
    const { page } = await openStats(CHARTS);
    const chart = '.tome-chart[data-chart="response-time"]';

    expect(await page.locator(chart).getAttribute("data-kind")).toBe("line");
    expect(await texts(page, `${chart} h3`)).toEqual(["Response time"]);
    expect(await texts(page, `${chart} .tome-meta`)).toEqual(["median · 3 days"]);
    expect(await marks(page, "response-time")).toEqual([
      ["2026-11-19", 1100],
      ["2026-11-21", 1000],
    ]);
    expect((await page.locator(`${chart} .tome-chart-line`).getAttribute("points"))!.split(" ")).toHaveLength(2);
    expect(await texts(page, `${chart} .tome-chart-y span`)).toEqual(["1.1 s", "1.05 s", "1 s"]);
    expect(await texts(page, `${chart} .tome-chart-x span`)).toEqual(["19 Nov", "20 Nov", "21 Nov"]);
  });

  it("draws a bar for every day of a bar chart, today's marked", async () => {
    const { page } = await openStats(CHARTS);
    const chart = '.tome-chart[data-chart="minutes"]';

    expect(await page.locator(chart).getAttribute("data-kind")).toBe("bar");
    expect(await marks(page, "minutes")).toEqual([
      ["2026-11-19", 10],
      ["2026-11-20", 0],
      ["2026-11-21", 5],
    ]);
    expect(await page.locator(`${chart} .tome-chart-bar[data-today]`).getAttribute("data-date")).toBe("2026-11-21");
    expect(await texts(page, `${chart} .tome-chart-y span`)).toEqual(["10 min", "5 min", "0 min"]);
  });

  it("shows accuracy as percentages and says when a chart has no data", async () => {
    const { page } = await openStats([ACCURACY, EMPTY]);

    expect(await marks(page, "accuracy")).toEqual([
      ["2026-11-19", 2 / 3],
      ["2026-11-21", 1],
    ]);
    expect(await texts(page, '.tome-chart[data-chart="accuracy"] .tome-chart-y span')).toEqual(["100%", "80%", "60%"]);
    expect(await page.locator('.tome-chart[data-chart="wpm"]').getAttribute("data-empty")).toBe("");
    expect(await texts(page, '.tome-chart[data-chart="wpm"] .tome-hint')).toEqual(["No data today yet."]);
  });

  it("keeps a line chart of zeros at or above zero", async () => {
    const { page } = await openStats([{ id: "flat", title: "Minutes", kind: "line", measure: "minutes", days: 1, items: { drill: "listen-kmrsu" } }]);

    expect(await marks(page, "flat")).toEqual([["2026-11-21", 0]]);
    expect(await texts(page, '.tome-chart[data-chart="flat"] .tome-chart-y span')).toEqual(["2 min", "1 min", "0 min"]);
  });

  it("asks for charts under the totals when the subject has none", async () => {
    const { page } = await openStats([]);

    expect(await page.locator(".tome-charts").count()).toBe(0);
    expect(await texts(page, '[data-view="stats"] > *')).toEqual([
      expect.stringContaining("practised"),
      "No charts yet. Ask your agent for charts of what you want to track.",
    ]);
  });

  it("sets charts two across on wide screens and stacks them on phones", async () => {
    const boxes = async (page: Page) =>
      Promise.all((await page.locator(".tome-chart").all()).map(async (chart) => (await chart.boundingBox())!));

    const phone = await openStats(CHARTS, "phone");
    const [a, b] = await boxes(phone.page);
    expect(b!.y).toBeGreaterThan(a!.y + a!.height);

    const desktop = await openStats(CHARTS, "desktop");
    const [c, d] = await boxes(desktop.page);
    expect(d!.y).toBe(c!.y);
    expect(d!.x).toBeGreaterThan(c!.x + c!.width);
  });
});

describe("Stats in /styleguide", () => {
  it.each(["phone", "desktop"] as const)("shows the Stats tab with demo charts, and without, at %s width", async (width) => {
    const { page, pageErrors, open } = await startDashboard({ width });
    await open("/styleguide");
    await page.waitForFunction(() => document.documentElement.dataset.styleguide, undefined, { timeout: 15000 });

    expect(await page.evaluate(() => document.documentElement.dataset.styleguideErrors ?? "")).toBe("");
    const tab = '#subject-home [data-styleguide-subject="stats"]';
    expect(await texts(page, `${tab} .tome-totals b`)).toEqual(["4h 12m", "38", "91%"]);
    expect(await page.locator(`${tab} .tome-chart`).evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).toEqual(["line", "bar"]);
    expect(await page.locator(`${tab} .tome-chart-dot`).count()).toBe(27);
    expect(await page.locator(`${tab} .tome-chart-bar`).count()).toBe(14);
    const empty = "#subject-home [data-styleguide-no-charts]";
    expect(await page.locator(`${empty} .tome-totals li`).count()).toBe(3);
    expect(await texts(page, `${empty} [data-view="stats"] > .tome-hint`)).toEqual([expect.stringMatching(/Ask your agent for charts/)]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 20_000);
});
