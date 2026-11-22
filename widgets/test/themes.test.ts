import { readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import { requiredTokenNames } from "../../core/src/theme-contract.ts";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFiles } from "../../core/test/helpers.ts";
import { startWidgetApp } from "./browser.ts";

const LESSON = "/s/morse-code/lessons/0001-k-and-m.html";

const look = () => {
  const body = getComputedStyle(document.body);
  const h1 = getComputedStyle(document.querySelector("h1")!);
  return { background: getComputedStyle(document.documentElement).backgroundColor, ink: body.color, h1: h1.fontStyle };
};

async function chooseTheme(root: string, theme: string) {
  const file = join(root, "tomewise.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), theme }));
}

describe("a lesson in the learner's theme", () => {
  it("renders in Paper by default", async () => {
    const { open } = await startWidgetApp();

    const page = await open(LESSON);

    expect(await page.evaluate(look)).toEqual({ background: "rgb(255, 255, 248)", ink: "rgb(29, 29, 27)", h1: "italic" });
  });

  it("follows the system's dark setting", async () => {
    const { open } = await startWidgetApp({ context: { colorScheme: "dark" } });

    const page = await open(LESSON);

    expect(await page.evaluate(look)).toMatchObject({ background: "rgb(22, 22, 20)", ink: "rgb(232, 230, 220)" });
  });

  it("lets data-mode override the system setting", async () => {
    const { open } = await startWidgetApp({ context: { colorScheme: "dark" } });
    const page = await open(LESSON);

    await page.evaluate(() => document.documentElement.setAttribute("data-mode", "light"));

    expect(await page.evaluate(look)).toMatchObject({ background: "rgb(255, 255, 248)" });
  });

  it("uses a theme from the learning home, whose rules beat the base styles without !important", async () => {
    const { open } = await startWidgetApp({
      prepare: async (root) => {
        await writeFiles(root, {
          "themes/moss/theme.json": { name: "Moss", author: "Me", version: "0.1.0" },
          "themes/moss/tokens.css": ":root { --t-bg: rgb(10, 40, 10); --t-ink: rgb(220, 240, 220); --t-display: serif; --t-ui: sans-serif; }",
          "themes/moss/theme.css": "h1 { font-style: oblique; } body { max-width: none; }",
        });
        await chooseTheme(root, "moss");
      },
    });

    const page = await open(LESSON);

    expect(await page.evaluate(look)).toEqual({ background: "rgb(10, 40, 10)", ink: "rgb(220, 240, 220)", h1: "oblique" });
  });
});

const BUILT_IN_THEMES = readdirSync(new URL("../../app/themes/", import.meta.url));

describe.each(BUILT_IN_THEMES)("the built-in %s theme", (theme) => {
  const css = readFileSync(new URL(`../../app/themes/${theme}/tokens.css`, import.meta.url), "utf8");

  async function tokensIn(page: Page, scheme: "light" | "dark", mode?: "light" | "dark") {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setContent(`<html${mode ? ` data-mode="${mode}"` : ""}><head><style>${css}</style></head></html>`);
    return page.evaluate(
      (names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()])),
      requiredTokenNames(),
    );
  }

  it("defines every required token in light and dark", async () => {
    const { page } = await startWidgetApp();
    const missing = (tokens: Record<string, string>) => Object.keys(tokens).filter((name) => tokens[name] === "");

    expect(missing(await tokensIn(page, "light")), "light").toEqual([]);
    expect(missing(await tokensIn(page, "dark")), "dark").toEqual([]);
  });

  it("gives every colour a dark value, the same whether the system or data-mode asks for dark", async () => {
    const { page } = await startWidgetApp();

    const light = await tokensIn(page, "light");
    const systemDark = await tokensIn(page, "dark");
    const modeDark = await tokensIn(page, "light", "dark");
    const forcedLight = await tokensIn(page, "dark", "light");

    expect(requiredTokenNames("color").filter((name) => systemDark[name] === light[name]), "unchanged in dark").toEqual([]);
    expect(modeDark).toEqual(systemDark);
    expect(forcedLight).toEqual(light);
  });
});

describe("Meadow", () => {
  async function meadowStyleguide(reducedMotion: "reduce" | "no-preference") {
    const app = await startWidgetApp({ context: { reducedMotion } });
    await app.page.addInitScript(() => {
      (window as any).leaves = 0;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) if (node instanceof Element && node.matches(".meadow-leaf")) (window as any).leaves++;
        }
      }).observe(document, { subtree: true, childList: true });
    });
    const page = await app.open("/styleguide?theme=meadow");
    await page.waitForFunction(() => document.documentElement.dataset.styleguide, undefined, { timeout: 15000 });
    return page;
  }

  const leafCount = (page: Page) => page.evaluate(() => (window as any).leaves as number);

  it("restyles lessons when tomewise.json chooses it", async () => {
    const { open } = await startWidgetApp({ prepare: (root) => chooseTheme(root, "meadow") });

    const page = await open(LESSON);

    expect(await page.locator('meta[name="tome-theme"]').getAttribute("content")).toBe("meadow");
    expect(await page.evaluate(look)).toEqual({ background: "rgb(243, 247, 238)", ink: "rgb(47, 58, 42)", h1: "normal" });
  });

  it("raises leaves from correct answers and from Start", async () => {
    const page = await meadowStyleguide("no-preference");
    expect(await leafCount(page)).toBeGreaterThan(0);
    const before = await leafCount(page);

    await page.locator("figure.styleguide-state", { hasText: /^ready/ }).locator("tome-routine .tome-start").click();

    expect(await leafCount(page)).toBe(before + 7);
  });

  it("raises no leaves when the learner prefers reduced motion", async () => {
    const page = await meadowStyleguide("reduce");

    await page.locator("figure.styleguide-state", { hasText: /^ready/ }).locator("tome-routine .tome-start").click();

    expect(await leafCount(page)).toBe(0);
  });
});
