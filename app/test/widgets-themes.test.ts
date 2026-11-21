import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../core/test/helpers.ts";
import { startTestApp } from "./harness.ts";

const LESSON = "subjects/morse-code/lessons/0001-k-and-m.html";
const TOME_JS = '<script type="module" src="/widgets/v1/tome.js"></script>';
const PAPER_CSS = '<link rel="stylesheet" href="/themes/paper/tokens.css">';

async function put(path: string, text: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

async function toolDirs() {
  const tool = await tempDir();
  await put(join(tool, "widgets/v1/tome.js"), "export const tome = 1;");
  await put(join(tool, "widgets/v1/quiz.js"), "export const quiz = 1;");
  await put(join(tool, "themes/paper/tokens.css"), ":root { --ink: black; }");
  await put(join(tool, "themes/paper/theme.json"), '{"name":"Paper"}');
  await put(join(tool, "secret.txt"), "tool secret");
  return { widgets: join(tool, "widgets"), themes: join(tool, "themes") };
}

async function startWithTool(prepare?: (root: string) => Promise<void>) {
  return startTestApp(prepare, await toolDirs());
}

describe("widgets and themes", () => {
  it("serves widgets at their versioned paths", async () => {
    const app = await startWithTool();

    const response = await app.get("/widgets/v1/tome.js");

    expect(response.status).toBe(200);
    expect(response.type).toBe("text/javascript; charset=utf-8");
    expect(response.body.toString()).toBe("export const tome = 1;");
  });

  it("serves built-in theme files", async () => {
    const app = await startWithTool();

    const response = await app.get("/themes/paper/tokens.css");

    expect(response.status).toBe(200);
    expect(response.type).toBe("text/css; charset=utf-8");
    expect(response.body.toString()).toBe(":root { --ink: black; }");
  });

  it("serves the learning home's themes alongside built-in ones", async () => {
    const app = await startWithTool(async (root) => {
      await put(join(root, "themes/moss/tokens.css"), ":root { --ink: green; }");
    });

    expect((await app.get("/themes/moss/tokens.css")).body.toString()).toBe(":root { --ink: green; }");
    expect((await app.get("/themes/paper/tokens.css")).body.toString()).toBe(":root { --ink: black; }");
  });

  it("prefers the learning home's theme folder over a built-in one of the same name", async () => {
    const app = await startWithTool(async (root) => {
      await put(join(root, "themes/paper/tokens.css"), ":root { --ink: blue; }");
    });

    expect((await app.get("/themes/paper/tokens.css")).body.toString()).toBe(":root { --ink: blue; }");
    expect((await app.get("/themes/paper/theme.json")).status).toBe(404);
  });

  it.each([
    ["a missing widget", "/widgets/v1/nope.js"],
    ["a missing theme", "/themes/meadow/tokens.css"],
    ["a theme folder", "/themes/paper"],
    ["an encoded slash out of widgets", "/widgets/v1%2f..%2f..%2fsecret.txt"],
    ["an encoded slash out of a theme", "/themes/paper/..%2f..%2fsecret.txt"],
    ["an encoded theme name escape", "/themes/..%2f..%2fsubjects/morse-code/subject.json"],
    ["a backslash", "/themes/paper/..%5c..%5csecret.txt"],
  ])("gives 404 for %s", async (_, path) => {
    const app = await startWithTool();

    expect((await app.get(path)).status).toBe(404);
  });
});

describe("lesson injection", () => {
  it("injects the theme CSS, tome.js and page data into a lesson's head", async () => {
    const app = await startWithTool();

    const html = (await app.get("/s/morse-code/lessons/0001-k-and-m.html")).body.toString();
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));

    expect(head).toContain(PAPER_CSS);
    expect(head).toContain(TOME_JS);
    expect(head).toContain('<meta name="tome-subject" content="morse-code">');
    expect(head).toContain('<meta name="tome-lesson" content="0001-k-and-m">');
    expect(html).toContain("<h1>K and M</h1>");
  });

  it("doesn't double-inject what the lesson already includes", async () => {
    const app = await startWithTool(async (root) => {
      const lesson = join(root, LESSON);
      const written = await readFile(lesson, "utf8");
      await writeFile(
        lesson,
        written.replace(
          "</head>",
          `<link href='/themes/paper/tokens.css' rel=stylesheet>\n<script src="/widgets/v1/tome.js" type="module"></script>\n</head>`,
        ),
      );
    });

    const html = (await app.get("/s/morse-code/lessons/0001-k-and-m.html")).body.toString();

    expect(html.match(/\/themes\/paper\/tokens\.css/g)).toHaveLength(1);
    expect(html.match(/\/widgets\/v1\/tome\.js/g)).toHaveLength(1);
    expect(html).toContain('<meta name="tome-lesson" content="0001-k-and-m">');
  });

  it("skips the theme link when the default theme doesn't exist", async () => {
    const app = await startTestApp(undefined, { widgets: await tempDir(), themes: await tempDir() });

    const response = await app.get("/s/morse-code/lessons/0001-k-and-m.html");
    const html = response.body.toString();

    expect(response.status).toBe(200);
    expect(html).not.toContain("/themes/");
    expect(html).toContain(TOME_JS);
  });

  it("uses the learning home's default theme when only it has one", async () => {
    const app = await startTestApp(
      async (root) => {
        await put(join(root, "themes/paper/tokens.css"), ":root {}");
      },
      { widgets: await tempDir(), themes: await tempDir() },
    );

    expect((await app.get("/s/morse-code/lessons/0001-k-and-m.html")).body.toString()).toContain(PAPER_CSS);
  });

  it("injects into a lesson with no head", async () => {
    const app = await startWithTool(async (root) => {
      await writeFile(join(root, LESSON), "<p>Just a paragraph</p>");
    });

    const html = (await app.get("/s/morse-code/lessons/0001-k-and-m.html")).body.toString();

    expect(html).toContain(TOME_JS);
    expect(html.indexOf(TOME_JS)).toBeLessThan(html.indexOf("<p>Just a paragraph</p>"));
  });

  it("injects after a head tag with attributes", async () => {
    const app = await startWithTool(async (root) => {
      await writeFile(join(root, LESSON), '<html><HEAD data-x="1"><title>t</title></HEAD><body></body></html>');
    });

    const html = (await app.get("/s/morse-code/lessons/0001-k-and-m.html")).body.toString();

    expect(html.indexOf('<HEAD data-x="1">')).toBeLessThan(html.indexOf(TOME_JS));
    expect(html.indexOf(TOME_JS)).toBeLessThan(html.indexOf("</HEAD>"));
  });

  it("leaves lesson assets and non-HTML files untouched", async () => {
    const app = await startWithTool(async (root) => {
      await writeFile(join(root, "subjects/morse-code/lessons/notes.txt"), "<head></head>");
    });

    expect((await app.get("/s/morse-code/lessons/notes.txt")).body.toString()).toBe("<head></head>");
  });

  it("leaves reference pages as written", async () => {
    const app = await startWithTool(async (root) => {
      await put(join(root, "subjects/morse-code/reference/alphabet.html"), "<head></head>");
    });

    expect((await app.get("/s/morse-code/reference/alphabet.html")).body.toString()).toBe("<head></head>");
  });
});
