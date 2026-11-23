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
  }, 20_000);

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

  it.each(["phone", "desktop"] as const)("shows the subject home and each of its tabs at %s width", async (width) => {
    const { page, pageErrors } = await openStyleguide(width);

    expect(await page.evaluate(() => document.documentElement.dataset.styleguideErrors ?? "")).toBe("");
    const tabs = await page
      .locator("#subject-home [data-styleguide-subject]")
      .evaluateAll((els) => els.map((el) => [el.getAttribute("data-styleguide-subject"), el.querySelector('.tome-tab[aria-selected="true"]')?.textContent]));
    expect(tabs).toEqual([
      ["overview", "Overview"],
      ["curriculum", "Curriculum"],
      ["drills", "Drills"],
      ["reference", "Reference"],
      ["stats", "Stats"],
    ]);
    const tab = (view: string) => `#subject-home [data-styleguide-subject="${view}"]`;
    expect(await texts(page, `${tab("overview")} .tome-goal-num`)).toEqual(["6\nof 10 min today · 4 to go"]);
    expect(await page.locator(`${tab("overview")} .tome-heatmap [data-level]`).count()).toBeGreaterThan(20);
    expect(await page.locator(`${tab("overview")} .tome-start`).getAttribute("href")).toBe("/run/due?subject=morse-code");
    expect(await page.locator(`${tab("curriculum")} .tome-lessons [data-done]`).count()).toBe(4);
    expect(await page.locator(`${tab("curriculum")} .tome-lessons [data-later]`).count()).toBe(2);
    expect(await page.locator(`${tab("drills")} [data-locked]`).count()).toBe(1);
    expect(await page.locator(`${tab("reference")} .tome-reference li`).count()).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 20_000);

  it("links home from the styleguide's contents", async () => {
    const { page } = await openStyleguide();

    expect(await page.locator('.styleguide-nav a[href="#home"]').innerText()).toBe("Home");
    expect(await page.locator('.styleguide-nav a[href="#subject-home"]').innerText()).toBe("Subject home");
  });

  it("stays ready, saying how to build it, when the dashboard isn't built", async () => {
    const { page, pageErrors } = await openStyleguide("phone", false);

    expect(await page.evaluate(() => document.documentElement.dataset.styleguide)).toBe("ready");
    expect(await texts(page, "#home .styleguide-unbuilt")).toEqual(["The dashboard isn't built. Run pnpm build:app to see it here."]);
    expect(pageErrors).toEqual([]);
  });
});

describe("the runner in /styleguide", () => {
  it.each(["phone", "desktop"] as const)("shows the runner running a demo drill and a summary at %s width", async (width) => {
    const { page, pageErrors } = await openStyleguide(width);

    expect(await page.evaluate(() => document.documentElement.dataset.styleguideErrors ?? "")).toBe("");
    expect(await page.locator("#runner .tome-runner").first().getAttribute("data-state")).toBe("running");
    expect(await texts(page, "#runner .tome-runner .tome-drill-name")).toEqual(["Vocabulary"]);
    expect(await page.locator("#runner tome-drill .tome-close").count()).toBe(1);
    expect(await page.locator("#runner tome-drill .tome-flashcard").count()).toBe(1);
    const summary = page.locator("#summary .tome-runner-summary");
    expect(await summary.locator(".tome-score").innerText()).toBe("60%");
    expect(await summary.locator(".tome-score-sub").innerText()).toBe("3 of 5 right");
    expect(await texts(page, "#summary .tome-look-again li")).toEqual([
      "adiós\nAgain\nLesson 1: greetings",
      "rojo\nWrong\nLesson 2: colours",
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 20_000);

  it("links the runner and summary from the styleguide's contents", async () => {
    const { page } = await openStyleguide();

    expect(await page.locator('.styleguide-nav a[href="#runner"]').innerText()).toBe("Runner");
    expect(await page.locator('.styleguide-nav a[href="#summary"]').innerText()).toBe("Summary");
  });
});
