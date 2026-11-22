import { readFile, writeFile } from "node:fs/promises";
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
