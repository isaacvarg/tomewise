import { describe, expect, it } from "vitest";
import { startDashboard, type Width } from "./browser.ts";

async function openStyleguide(width: Width = "phone", built = true) {
  const dashboard = await startDashboard({ width, built });
  const page = await dashboard.open("/styleguide");
  await page.waitForFunction(() => document.documentElement.dataset.styleguide, undefined, { timeout: 15000 });
  return { ...dashboard, page };
}

const texts = (page: Awaited<ReturnType<typeof openStyleguide>>["page"], selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));

describe("home in /styleguide", () => {
  it.each(["phone", "desktop"] as const)("shows home with demo data at %s width", async (width) => {
    const { page, pageErrors } = await openStyleguide(width);

    expect(await page.evaluate(() => document.documentElement.dataset.styleguideErrors ?? "")).toBe("");
    expect(await page.evaluate(() => document.documentElement.dataset.styleguide)).toBe("ready");
    const home = page.locator("#home .tome-app");
    expect(await home.getAttribute("data-state")).toBe("ready");
    expect(await texts(page, "#home .tome-kicker")).toEqual(["Saturday 21 November"]);
    expect(await texts(page, "#home .tome-subject-name")).toEqual(["3x3 cube", "Morse code", "Spanish", "Yoga"]);
    expect(await texts(page, "#home .tome-due li")).toEqual(["Morse code\n9 items · 6 min", "Spanish\n4 items · 3 min"]);
    expect(await texts(page, "#home .tome-streak-num")).toEqual(["6"]);
    expect(await page.locator("#home .tome-heatmap [data-level]").count()).toBeGreaterThan(100);
    expect(await page.locator("#home .tome-start").innerText()).toMatch(/^Start\s+13 items, about 9 min$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it("lays home out for the width of the page", async () => {
    const phone = await openStyleguide("phone");
    const desktop = await openStyleguide("desktop");

    const streakBesideDue = (page: typeof phone.page) =>
      page.evaluate(
        () =>
          document.querySelector("#home .tome-streak")!.getBoundingClientRect().top ===
          document.querySelector("#home .tome-due")!.getBoundingClientRect().top,
      );
    expect(await streakBesideDue(phone.page)).toBe(false);
    expect(await streakBesideDue(desktop.page)).toBe(true);
  }, 20_000);

  it("links home from the styleguide's contents", async () => {
    const { page } = await openStyleguide();

    expect(await page.locator('.styleguide-nav a[href="#home"]').innerText()).toBe("Home");
  });

  it("stays ready, saying how to build it, when the dashboard isn't built", async () => {
    const { page, pageErrors } = await openStyleguide("phone", false);

    expect(await page.evaluate(() => document.documentElement.dataset.styleguide)).toBe("ready");
    expect(await texts(page, "#home .styleguide-unbuilt")).toEqual(["The dashboard isn't built. Run pnpm build:app to see it here."]);
    expect(pageErrors).toEqual([]);
  });
});
