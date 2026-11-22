import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir, writeFiles } from "../../core/test/helpers.ts";
import { startTestApp } from "./harness.ts";

const LESSON = "/s/morse-code/lessons/0001-k-and-m.html";
const LAYERS = "@layer tome.reset, tome.base, tome.widgets, theme;";

const tokens = (name: string) => `@import url("/themes/${name}/tokens.css") layer(theme);`;
const themeCss = (name: string) => `@import url("/themes/${name}/theme.css") layer(theme);`;
const manifest = (name: string, extra: Record<string, string> = {}) => ({ name, author: "Tomewise", version: "1.0.0", ...extra });

async function toolWith(themes: Record<string, unknown> = {}) {
  const tool = await tempDir();
  await writeFiles(tool, {
    "widgets/v1/tome.js": "export {};",
    "widgets/v1/base.css": "@layer tome.base { body { margin: 0; } }",
    "themes/paper/theme.json": manifest("Paper"),
    "themes/paper/tokens.css": ":root { --t-ink: black; }",
    ...themes,
  });
  return { widgets: join(tool, "widgets"), themes: join(tool, "themes") };
}

async function chooseTheme(root: string, theme: string) {
  const file = join(root, "tomewise.json");
  const config = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...config, theme }));
}

async function headOf(app: { raw: (path: string) => Promise<{ body: Buffer }> }, path = LESSON) {
  const html = (await app.raw(path)).body.toString();
  return html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
}

describe("theme loader", () => {
  it("loads Paper when tomewise.json chooses no theme", async () => {
    const app = await startTestApp(undefined, await toolWith());

    const head = await headOf(app);

    expect(head).toContain(tokens("paper"));
    expect(head).toContain('<meta name="tome-theme" content="paper">');
    expect(app.warnings).toEqual([]);
  });

  it("loads the theme tomewise.json chooses", async () => {
    const tool = await toolWith({
      "themes/meadow/theme.json": manifest("Meadow"),
      "themes/meadow/tokens.css": ":root { --t-ink: green; }",
    });
    const app = await startTestApp((root) => chooseTheme(root, "meadow"), tool);

    const head = await headOf(app);

    expect(head).toContain(tokens("meadow"));
    expect(head).not.toContain("/themes/paper/");
  });

  it("loads a theme from the learning home's themes folder", async () => {
    const app = await startTestApp(async (root) => {
      await writeFiles(root, {
        "themes/moss/theme.json": manifest("Moss"),
        "themes/moss/tokens.css": ":root { --t-ink: darkgreen; }",
      });
      await chooseTheme(root, "moss");
    }, await toolWith());

    expect(await headOf(app)).toContain(tokens("moss"));
    expect((await app.raw("/themes/moss/tokens.css")).body.toString()).toBe(":root { --t-ink: darkgreen; }");
  });

  it("falls back to Paper with one warning when the chosen theme doesn't exist", async () => {
    const app = await startTestApp((root) => chooseTheme(root, "nope"), await toolWith());

    const head = await headOf(app);
    await headOf(app);

    expect(head).toContain(tokens("paper"));
    expect(head).toContain('<meta name="tome-theme" content="paper">');
    expect(app.warnings).toEqual(['Theme "nope" is not in themes/ or the built-in themes; using Paper.']);
  });

  it("adds theme.css and the theme's script only when the theme has them", async () => {
    const tool = await toolWith({
      "themes/meadow/theme.json": manifest("Meadow", { script: "leaves.js" }),
      "themes/meadow/tokens.css": ":root {}",
      "themes/meadow/theme.css": ".tome-app {}",
      "themes/meadow/leaves.js": "export {};",
    });
    const paper = await headOf(await startTestApp(undefined, tool));
    const meadow = await headOf(await startTestApp((root) => chooseTheme(root, "meadow"), tool));

    expect(paper).not.toContain("theme.css");
    expect(paper).not.toMatch(/<script[^>]+\/themes\//);
    expect(meadow).toContain(themeCss("meadow"));
    expect(meadow).toContain('<script type="module" src="/themes/meadow/leaves.js"></script>');
  });

  it("declares the layer order once, before base, widget and theme CSS", async () => {
    const app = await startTestApp(undefined, await toolWith());

    const head = await headOf(app);

    expect(head.split(LAYERS)).toHaveLength(2);
    const order = [LAYERS, '@import url("/widgets/v1/base.css");', tokens("paper"), "/widgets/v1/tome.js"].map((text) =>
      head.indexOf(text),
    );
    expect(order.every((index) => index !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("follows a theme change in tomewise.json without a restart", async () => {
    const tool = await toolWith({
      "themes/meadow/theme.json": manifest("Meadow"),
      "themes/meadow/tokens.css": ":root {}",
    });
    const app = await startTestApp(undefined, tool);
    expect(await headOf(app)).toContain(tokens("paper"));

    await chooseTheme(app.root, "meadow");

    await expect.poll(() => headOf(app), { timeout: 5000 }).toContain(tokens("meadow"));
  });

  it("ignores a script path that leaves the theme folder", async () => {
    const tool = await toolWith({
      "themes/bad/theme.json": manifest("Bad", { script: "../paper/x.js" }),
      "themes/bad/tokens.css": ":root {}",
    });
    const app = await startTestApp((root) => chooseTheme(root, "bad"), tool);

    expect(await headOf(app)).not.toMatch(/<script[^>]+\/themes\//);
  });
});

describe("the dashboard page", () => {
  it("gets the chosen theme too", async () => {
    const tool = await toolWith({
      "themes/meadow/theme.json": manifest("Meadow", { script: "leaves.js" }),
      "themes/meadow/tokens.css": ":root {}",
      "themes/meadow/leaves.js": "export {};",
    });
    const spa = await tempDir();
    await writeFiles(spa, { "index.html": "<!doctype html><html><head><title>Tomewise</title></head><body></body></html>" });
    const app = await startTestApp((root) => chooseTheme(root, "meadow"), tool, { spa });

    for (const path of ["/", "/settings"]) {
      const head = await headOf(app, path);
      expect(head, path).toContain(LAYERS);
      expect(head, path).toContain(tokens("meadow"));
      expect(head, path).toContain('<script type="module" src="/themes/meadow/leaves.js"></script>');
      expect(head, path).not.toContain("tome-page-kind");
    }
  });
});
