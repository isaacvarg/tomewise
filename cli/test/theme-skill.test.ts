import { existsSync, readFileSync } from "node:fs";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requiredTokenNames } from "@tomewise/core";
import { copyExample, tempDir } from "../../core/test/helpers.ts";
import { BUILT_IN } from "../../app/src/tool-files.ts";
import { buildWidgets } from "../../widgets/scripts/build.ts";
import { run } from "../src/main.ts";

const SKILL_DIR = new URL("../../skill/skills/theme/", import.meta.url);
const SKILL = readFileSync(new URL("SKILL.md", SKILL_DIR), "utf8");
const REPO = new URL("../../", import.meta.url);

const MOSS = {
  light: { "#9a3b1e": "#3f6b2a", "#ebcdbd": "#dbe8cc", "#d39a7f": "#a9c98f", "#b8623f": "#6f9a52" },
  dark: { "#e0835f": "#9ccf7a", "#4a2e22": "#2b3a22", "#7a4330": "#42602f", "#b0603f": "#6f9a52" },
};

function recolour(css: string): string {
  const dark = css.indexOf("@media (prefers-color-scheme: dark)");
  let light = css.slice(0, dark);
  let rest = css.slice(dark);
  for (const [from, to] of Object.entries(MOSS.light)) light = light.replaceAll(from, to);
  for (const [from, to] of Object.entries(MOSS.dark)) rest = rest.replaceAll(from, to);
  return light + rest;
}

function step(heading: string): string {
  const start = SKILL.indexOf(`\n## ${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const end = SKILL.indexOf("\n## ", start + 1);
  return SKILL.slice(start, end === -1 ? undefined : end);
}

describe("skill/skills/theme/SKILL.md", () => {
  it("is the theme skill, with a description the agent can trigger on", () => {
    expect(SKILL).toMatch(/^---\nname: theme\ndescription: .*theme.*\n/);
    expect(SKILL).not.toMatch(/disable-model-invocation/);
  });

  it("points at the theme contract", () => {
    const [, path] = SKILL.match(/https:\/\/github\.com\/isaacvarg\/tomewise\/blob\/main\/(docs\/[\w.-]+\.md)/) ?? [];
    expect(path).toBe("docs/themes.md");
    expect(existsSync(new URL(path!, REPO))).toBe(true);
  });

  it("holds the checklist: phone width, light and dark, contrast, every page and widget", () => {
    const checklist = step("3. Hold the checklist");
    expect(checklist).toContain("in light and in dark");
    expect(checklist).toContain("**Contrast**");
    expect(checklist).toContain("**Phone width**: at 375px");
    expect(checklist).toContain("**Every page and widget**");
    expect(checklist).toContain("/styleguide?theme=<name>");
  });

  it("ends by running tome theme check and fixing what it reports", () => {
    const last = SKILL.slice(SKILL.lastIndexOf("\n## "));
    expect(last).toContain("tome theme check <name>");
    expect(last).toMatch(/Fix .* run the check again/);
    expect(last).toMatch(/Done when the check exits 0/);
  });

  it("ships a starter that defines every required token in all three blocks", async () => {
    const tokens = await readFile(new URL("starter/tokens.css", SKILL_DIR), "utf8");
    for (const token of requiredTokenNames()) expect(tokens).toContain(`${token}:`);
    expect(tokens).toContain("@media (prefers-color-scheme: dark)");
    expect(tokens).toContain(':root[data-mode="dark"]');
  });
});

describe("a theme written by the theme skill", { timeout: 120_000 }, () => {
  it("passes tome theme check", async () => {
    const home = await copyExample("morse");
    const theme = join(home, "themes/moss");

    await cp(new URL("starter/", SKILL_DIR), theme, { recursive: true });
    await writeFile(
      join(theme, "theme.json"),
      JSON.stringify({ name: "Moss", author: "A learner", version: "0.1.0", description: "Mossy and quiet." }, null, 2),
    );
    const tokens = join(theme, "tokens.css");
    const before = await readFile(tokens, "utf8");
    await writeFile(tokens, recolour(before));
    await writeFile(join(theme, "theme.css"), ".tome-header { border-bottom: 2px solid var(--t-accent); padding-bottom: .9rem; }\n");
    expect(await readFile(tokens, "utf8")).not.toBe(before);

    const widgets = await tempDir();
    await buildWidgets(widgets);
    const out = await tempDir();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run(["theme", "check", "moss", "--out", out], {
      cwd: home,
      env: { HOME: await tempDir() },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      tool: { widgets, themes: BUILT_IN.themes },
    });

    expect(stderr.join("\n")).toBe("");
    expect(stdout.join("\n")).toContain("moss passes");
    expect(code).toBe(0);
    expect(await readdir(out)).toHaveLength(6);
  });
});
