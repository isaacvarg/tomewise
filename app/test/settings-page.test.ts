import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

const FIXTURE_CONFIG = await readFile(new URL("./fixtures/dashboard/tomewise.json", import.meta.url), "utf8");

async function openSettings(width: Width = "phone") {
  const dashboard = await startDashboard({ width });
  const page = await dashboard.open("/settings");
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  const file = () => readFile(join(dashboard.app.root, "tomewise.json"), "utf8");
  return { ...dashboard, page, file };
}

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector(".tome-app")!).backgroundColor);
const themeMeta = (page: Page) => page.locator('meta[name="tome-theme"]').getAttribute("content");
const texts = (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));
const order = (page: Page) => texts(page, ".tome-order-name");

describe("theme", () => {
  it("previews a theme on the page before saving, and Cancel puts the saved one back", async () => {
    const { page, file, pageErrors } = await openSettings();
    const paper = await background(page);

    await page.getByRole("radio", { name: "Meadow" }).check();

    await expect.poll(() => background(page)).not.toBe(paper);
    expect(await themeMeta(page)).toBe("meadow");
    expect(await file()).toBe(FIXTURE_CONFIG);

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect.poll(() => background(page)).toBe(paper);
    expect(await themeMeta(page)).toBe("paper");
    expect(await page.getByRole("radio", { name: "Paper" }).isChecked()).toBe(true);
    expect(await page.getByRole("button", { name: "Save" }).count()).toBe(0);
    expect(await file()).toBe(FIXTURE_CONFIG);
    expect(pageErrors).toEqual([]);
  });

  it("saves the previewed theme to tomewise.json, changing only theme", async () => {
    const { page, file } = await openSettings();
    await page.getByRole("radio", { name: "Meadow" }).check();

    const reloaded = page.waitForEvent("load");

    await page.getByRole("button", { name: "Save" }).click();

    await reloaded;
    expect(await file()).toBe(FIXTURE_CONFIG.replace('"restDaysPerWeek": 1 }\n', '"restDaysPerWeek": 1 },\n  "theme": "meadow"\n'));
    expect(await themeMeta(page)).toBe("meadow");
    await page.locator('.tome-app[data-state="ready"]').waitFor();
    expect(await page.getByRole("radio", { name: "Meadow" }).isChecked()).toBe(true);
    expect(await page.getByRole("button", { name: "Save" }).count()).toBe(0);
  });

  it("drops an unsaved preview when the learner leaves the page", async () => {
    const { page } = await openSettings();
    const paper = await background(page);
    await page.getByRole("radio", { name: "Meadow" }).check();
    await expect.poll(() => background(page)).not.toBe(paper);

    await page.getByRole("link", { name: "Today" }).click();

    await page.waitForURL(/\/$/);
    await expect.poll(() => background(page)).toBe(paper);
    expect(await themeMeta(page)).toBe("paper");
  });
});

describe("Start mode", () => {
  it("defaults to in sequence and saves ask to tomewise.json, changing only start", async () => {
    const { page, file } = await openSettings();
    expect(await page.getByRole("radio", { name: "In sequence" }).isChecked()).toBe(true);

    await page.getByRole("radio", { name: "Ask" }).check();

    await expect.poll(file).toBe(FIXTURE_CONFIG.replace('"restDaysPerWeek": 1 }\n', '"restDaysPerWeek": 1 },\n  "start": "ask"\n'));
  });
});

describe("subject order", () => {
  it("lists subjects alphabetically until an order is saved", async () => {
    const { page } = await openSettings();

    expect(await order(page)).toEqual(["Morse code", "Spanish", "Yoga"]);
    expect(await page.getByRole("button", { name: "Move Morse code up" }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Move Yoga down" }).isDisabled()).toBe(true);
  });

  it("reorders with the keyboard, keeping focus on the moved subject, and the home grid follows", async () => {
    const { page, file } = await openSettings();

    await page.getByRole("button", { name: "Move Yoga up" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => order(page)).toEqual(["Morse code", "Yoga", "Spanish"]);
    await page.keyboard.press("Enter");

    await expect.poll(() => order(page)).toEqual(["Yoga", "Morse code", "Spanish"]);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Move Yoga down");
    await expect
      .poll(file)
      .toBe(FIXTURE_CONFIG.replace('"restDaysPerWeek": 1 }\n', '"restDaysPerWeek": 1 },\n  "subjects": ["yoga", "morse-code", "spanish"]\n'));

    await page.getByRole("link", { name: "Today" }).click();
    await page.locator('.tome-app[data-state="ready"] .tome-subject-name').first().waitFor();
    expect(await texts(page, ".tome-subject-name")).toEqual(["Yoga", "Morse code", "Spanish"]);
  });

  it.each(["phone", "desktop"] as const)("reorders by dragging a row's handle at %s width", async (width) => {
    const { page, file } = await openSettings(width);
    const handle = await page.locator('.tome-order-row[data-subject="spanish"] .tome-order-handle').boundingBox();
    const target = await page.locator('.tome-order-row[data-subject="morse-code"]').boundingBox();

    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2, target!.y + 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => order(page)).toEqual(["Spanish", "Morse code", "Yoga"]);
    await expect.poll(file).toContain('"subjects": ["spanish", "morse-code", "yoga"]');
  });

  it("drags a row down past several others", async () => {
    const { page, file } = await openSettings();
    const handle = await page.locator('.tome-order-row[data-subject="morse-code"] .tome-order-handle').boundingBox();
    const target = await page.locator('.tome-order-row[data-subject="yoga"]').boundingBox();

    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2, target!.y + target!.height - 2, { steps: 12 });
    await page.mouse.up();

    await expect.poll(() => order(page)).toEqual(["Spanish", "Yoga", "Morse code"]);
    await expect.poll(file).toContain('"subjects": ["spanish", "yoga", "morse-code"]');
    expect(await page.locator(".tome-order-row[data-dragging]").count()).toBe(0);
  });

  it("puts subjects the saved order leaves out after it, alphabetically", async () => {
    const dashboard = await startDashboard({
      prepare: async (root) => {
        await writeFile(join(root, "tomewise.json"), FIXTURE_CONFIG.replace("{\n", '{\n  "subjects": ["yoga", "chess"],\n'));
      },
    });

    const page = await dashboard.open("/");
    await page.locator('.tome-app[data-state="ready"]').waitFor();
    expect(await texts(page, ".tome-subject-name")).toEqual(["Yoga", "Morse code", "Spanish"]);

    await page.goto(`${dashboard.app.url}/settings`);
    await page.locator('.tome-app[data-state="ready"]').waitFor();
    expect(await order(page)).toEqual(["Yoga", "Morse code", "Spanish"]);
  });
});

describe("quizzes and exams", () => {
  const subjectFile = (root: string, id: string) => readFile(join(root, "subjects", id, "subject.json"), "utf8");
  const resolved = async (url: string, id: string) =>
    ((await (await fetch(`${url}/api/subjects/${id}`)).json()) as { settings: { assessments: Record<string, unknown> } }).settings.assessments;

  it("saves the home defaults to tomewise.json, and Cancel drops unsaved changes", async () => {
    const { page, file, app } = await openSettings();
    const home = page.locator('[data-setting="assessments"]');
    expect(await home.getByLabel("Quiz frequency").inputValue()).toBe("every");
    expect(await home.getByLabel("Pass mark").inputValue()).toBe("70");

    await home.getByLabel("Pass mark").fill("55");
    await home.getByRole("button", { name: "Cancel" }).click();

    expect(await home.getByLabel("Pass mark").inputValue()).toBe("70");
    expect(await file()).toBe(FIXTURE_CONFIG);

    await home.getByLabel("Quiz frequency").selectOption("weekly");
    await home.getByLabel("Time limit").selectOption("limit");
    await home.getByLabel("Minutes").fill("15");
    await home.getByLabel("Score").selectOption("pass-fail");
    await home.getByLabel("Pass mark").fill("80");
    await home.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => home.getByRole("button", { name: "Save" }).count()).toBe(0);
    const config = JSON.parse(await file());
    expect(config.assessments).toEqual({
      enabled: true,
      quizFrequency: "weekly",
      quizLength: 10,
      exams: true,
      timed: { minutes: 15 },
      scoreDisplay: "pass-fail",
      passMark: 80,
    });
    expect(config.streak).toEqual({ restDaysPerWeek: 1 });
    expect(await resolved(app.url, "spanish")).toMatchObject({ quizFrequency: "weekly", passMark: 80 });
  });

  it("turns assessments off for one subject in its subject.json, leaving the others on the home defaults", async () => {
    const { page, file, app } = await openSettings();
    const yoga = page.getByRole("group", { name: "Yoga" });
    const before = await subjectFile(app.root, "spanish");
    expect(await yoga.getByLabel("Quizzes and exams").inputValue()).toBe("");
    expect(await yoga.getByLabel("Quizzes and exams").locator("option").first().innerText()).toBe("Home default (on)");

    await yoga.getByLabel("Quizzes and exams").selectOption("off");
    await yoga.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => yoga.getByRole("button", { name: "Save" }).count()).toBe(0);
    expect(JSON.parse(await subjectFile(app.root, "yoga")).settings.assessments).toEqual({ enabled: false });
    expect(await resolved(app.url, "yoga")).toMatchObject({ enabled: false, passMark: 70 });
    expect(await resolved(app.url, "spanish")).toMatchObject({ enabled: true });
    expect(await subjectFile(app.root, "spanish")).toBe(before);
    expect(await file()).toBe(FIXTURE_CONFIG);

    await yoga.getByLabel("Quizzes and exams").selectOption("");
    await yoga.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => resolved(app.url, "yoga")).toMatchObject({ enabled: true });
    expect(JSON.parse(await subjectFile(app.root, "yoga")).settings.assessments).toEqual({});
  });

  it("shows a subject's own pass mark over the home default, which it names", async () => {
    const { page, app } = await openSettings();
    const spanish = page.getByRole("group", { name: "Spanish" });
    expect(await spanish.getByLabel("Pass mark").getAttribute("placeholder")).toBe("70");
    expect(await spanish.getByLabel("Quiz frequency").locator("option").first().innerText()).toBe("Home default (every 5 lessons)");

    await spanish.getByLabel("Pass mark").fill("90");
    await spanish.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => resolved(app.url, "spanish")).toMatchObject({ passMark: 90 });
    const home = page.locator('[data-setting="assessments"]');
    await home.getByLabel("Pass mark").fill("60");
    await home.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => spanish.getByLabel("Pass mark").getAttribute("placeholder")).toBe("60");
    expect(await spanish.getByLabel("Pass mark").inputValue()).toBe("90");
    expect(await resolved(app.url, "spanish")).toMatchObject({ passMark: 90 });
    expect(await resolved(app.url, "yoga")).toMatchObject({ passMark: 60 });
  });

  it("shows why a save was refused and leaves the file alone", async () => {
    const { page, file } = await openSettings();
    const home = page.locator('[data-setting="assessments"]');

    await home.getByLabel("Pass mark").fill("150");
    await home.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => home.innerText()).toMatch(/passMark/);
    expect(await file()).toBe(FIXTURE_CONFIG);
  });
});

describe("the settings page", () => {
  it.each(["phone", "desktop"] as const)("fits a %s screen and uses only the theme contract's dashboard classes", async (width) => {
    const { page, pageErrors } = await openSettings(width);

    const used = await page
      .locator(".tome-app, .tome-app *")
      .evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))))]);
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  it("is in /styleguide with demo data", async () => {
    const { open, pageErrors } = await startDashboard();
    const page = await open("/styleguide");
    await page.waitForFunction(() => document.documentElement.dataset.styleguide, undefined, { timeout: 15000 });

    expect(await page.evaluate(() => document.documentElement.dataset.styleguide)).toBe("ready");
    expect(await page.locator('.styleguide-nav a[href="#settings"]').innerText()).toBe("Settings");
    expect(await texts(page, "#settings .tome-title")).toEqual(["Settings"]);
    expect(await texts(page, "#settings .tome-order-name")).toEqual(["3x3 cube", "Morse code", "Spanish", "Yoga"]);
    expect(await page.locator("#settings").getByRole("radio", { name: "Paper" }).isChecked()).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 20_000);
});
