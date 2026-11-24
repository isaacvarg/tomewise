import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appClasses, requiredTokenNames, themeTokens, widgetClasses } from "../src/theme-contract.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const DOC = read("docs/themes.md");
const codes = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);

function section(heading: string): string {
  const start = DOC.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const end = DOC.slice(start + heading.length + 2).search(/\n#{2,3} /);
  return DOC.slice(start, end === -1 ? undefined : start + heading.length + 2 + end);
}

describe("docs/themes.md", () => {
  it("lists every required token with its kind and use", () => {
    const rows = section("## Tokens")
      .split("\n")
      .filter((line) => line.startsWith("| `--t-"))
      .map((line) => line.split("|").slice(1, 4).map((cell) => cell.trim()));
    expect(rows).toEqual(themeTokens.map(({ name, kind, usedFor }) => [`\`${name}\``, kind, usedFor]));
  });

  it("lists every widget's classes", () => {
    const rows = section("### Widget classes")
      .split("\n")
      .filter((line) => line.startsWith("| `<"))
      .map((line) => {
        const [tag, classes] = line.split("|").slice(1, 3).map(codes);
        return [tag![0]!.slice(1, -1), classes];
      });
    expect(Object.fromEntries(rows)).toEqual(widgetClasses);
  });

  it("lists the dashboard classes", () => {
    expect(codes(section("### Dashboard classes")).filter((name) => name.startsWith("tome-"))).toEqual(appClasses);
  });

  it("warns that theme JavaScript runs on every page", () => {
    expect(section("## Trust")).toMatch(/JavaScript runs on every page/);
  });
});

describe("skill/skills/teach/SKILL.md", () => {
  it.each(requiredTokenNames())("tells agents about %s", (token) => {
    const skill = read("skill/skills/teach/SKILL.md").replace("`--t-heat-0` to `--t-heat-4`", "`--t-heat-0` `--t-heat-1` `--t-heat-2` `--t-heat-3` `--t-heat-4`");
    expect(skill).toContain(`\`${token}\``);
  });
});
