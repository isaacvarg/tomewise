import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itemTypes } from "../../core/src/items.ts";

const SRC = new URL("../src/", import.meta.url);
const DOC = readFileSync(new URL("../../docs/widgets.md", import.meta.url), "utf8");

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

function section(heading: string): string {
  const start = DOC.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const end = DOC.indexOf("\n## ", start + heading.length + 2);
  return DOC.slice(start, end === -1 ? undefined : end);
}

const codes = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);

const contract = new Map(
  section("### Classes and tokens per widget")
    .split("\n")
    .filter((line) => line.startsWith("| `<"))
    .map((line) => {
      const [tag, classes, tokens] = line.split("|").slice(1, 4).map(codes);
      return [tag![0]!.slice(1, -1), { classes: classes!, tokens: tokens! }] as const;
    }),
);

const markupBlocks = [...DOC.matchAll(/```html\n(<(tome-[a-z-]+)[\s\S]*?)```/g)].map((match) => match[1]!);

describe("the theme contract in docs/widgets.md", () => {
  it("lists every widget tag", () => {
    expect([...contract.keys()].sort()).toEqual(TAGS);
  });

  it.each(TAGS)("lists the classes and tokens <%s> renders", (tag) => {
    const { classes, tokens } = rendered(tag);
    expect(contract.get(tag)?.classes, "classes").toEqual(classes);
    expect(contract.get(tag)?.tokens, "tokens").toEqual(tokens);
  });

  it.each(TAGS)("shows every class of <%s> in its markup, and nothing it doesn't render", (tag) => {
    const block = markupBlocks.filter((markup) => markup.includes(`class="${tag}"`)).join("\n");
    expect(block, `markup block for ${tag}`).not.toBe("");
    const documented = new Set(block.match(/tome-[a-z-]+/g));
    const { classes, mentioned } = rendered(tag);
    expect(classes.filter((name) => !documented.has(name)), "rendered but not shown").toEqual([]);
    expect([...documented].filter((name) => !mentioned.has(name) && !TAGS.includes(name)), "shown but not rendered").toEqual([]);
  });

  it("describes every token the widgets use", () => {
    const table = section("### Tokens")
      .split("\n")
      .filter((line) => line.startsWith("| `--t-"))
      .map((line) => codes(line.split("|")[1]!)[0]!);
    expect(table.sort()).toEqual(sorted(TAGS.flatMap((tag) => rendered(tag).tokens)));
  });
});

describe("skill/WIDGETS.md", () => {
  const skill = readFileSync(new URL("../../skill/WIDGETS.md", import.meta.url), "utf8");

  it.each(TAGS)("points agents at <%s>", (tag) => {
    expect(skill).toContain(`<${tag}`);
  });

  it.each(itemTypes)("names the widget for %s items", (type) => {
    expect(skill).toMatch(new RegExp(`^\\| \`${type}\` +\\| \`<tome-`, "m"));
  });
});
