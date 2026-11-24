import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itemTypes } from "../../core/src/items.ts";
import { requiredTokenNames, widgetClasses } from "../../core/src/theme-contract.ts";

const SRC = new URL("../src/", import.meta.url);
const WIDGETS_DOC = readFileSync(new URL("../../docs/widgets.md", import.meta.url), "utf8");

const source = (file: string) => readFileSync(new URL(file, SRC), "utf8");
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

const TAGS = sorted([...source("loader.ts").matchAll(/"(tome-[a-z-]+)": \(\) => import/g)].map((match) => match[1]!));

function filesOf(tag: string): string[] {
  const files: string[] = [];
  const visit = (file: string) => {
    if (files.includes(file)) return;
    files.push(file);
    for (const [, imported] of source(file).matchAll(/^import (?!type )[^;]*?"\.\/([\w-]+\.ts)"/gm)) {
      if (!imported!.startsWith("tome-")) visit(imported!);
    }
  };
  visit(`${tag}.ts`);
  return files;
}

function rendered(tag: string) {
  const code = filesOf(tag).map(source).join("\n");
  const classes = [...code.matchAll(/class(?:Name = |=)"([^"]+)"/g)].flatMap((match) => match[1]!.split(/\s+/));
  return {
    classes: sorted([tag, ...classes]),
    tokens: sorted([...code.matchAll(/var\((--t-[\w-]+)/g)].map((match) => match[1]!)),
    mentioned: new Set(code.match(/tome-[a-z-]+/g)),
  };
}

const markupBlocks = [...WIDGETS_DOC.matchAll(/```html\n(<(tome-[a-z-]+)[\s\S]*?)```/g)].map((match) => match[1]!);

describe("the theme contract's widget classes", () => {
  it("lists every widget tag", () => {
    expect(Object.keys(widgetClasses).sort()).toEqual(TAGS);
  });

  it.each(TAGS)("lists the classes <%s> renders", (tag) => {
    expect(widgetClasses[tag]).toEqual(rendered(tag).classes);
  });

  it.each(TAGS)("covers every token <%s> reads", (tag) => {
    expect(rendered(tag).tokens.filter((token) => !requiredTokenNames().includes(token))).toEqual([]);
  });

  it.each(TAGS)("shows every class of <%s> in its markup in docs/widgets.md, and nothing it doesn't render", (tag) => {
    const block = markupBlocks.filter((markup) => markup.includes(`class="${tag}"`)).join("\n");
    expect(block, `markup block for ${tag}`).not.toBe("");
    const documented = new Set(block.match(/tome-[a-z-]+/g));
    const { classes, mentioned } = rendered(tag);
    expect(classes.filter((name) => !documented.has(name)), "rendered but not shown").toEqual([]);
    expect([...documented].filter((name) => !mentioned.has(name) && !TAGS.includes(name)), "shown but not rendered").toEqual([]);
  });
});

describe("skill/skills/teach/WIDGETS.md", () => {
  const skill = readFileSync(new URL("../../skill/skills/teach/WIDGETS.md", import.meta.url), "utf8");

  it.each(TAGS)("points agents at <%s>", (tag) => {
    expect(skill).toContain(`<${tag}`);
  });

  it.each(itemTypes)("names the widget for %s items", (type) => {
    expect(skill).toMatch(new RegExp(`^\\| \`${type}\` +\\| \`<tome-`, "m"));
  });
});
