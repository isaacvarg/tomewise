import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Hono, type Context } from "hono";
import type { LearningHome } from "@tomewise/core";
import { contentTypeOf, resolveUnder, sendFile } from "./files.ts";
import { injectPage, type PageKind } from "./inject.ts";
import { resolveThemeFile, type ToolDirs } from "./tool-files.ts";

const CONTEXT_PAGES = { lessons: "lesson", quizzes: "quiz", exams: "exam" } as const satisfies Record<string, PageKind>;
type ContextFolder = keyof typeof CONTEXT_PAGES;
type PageFolder = ContextFolder | "reference" | "assets";

const DEFAULT_THEME = "paper";

async function resolvePage(c: Context, home: LearningHome, folder: PageFolder, path: string) {
  const subject = c.req.param("subject")!;
  if (!home.subjects.includes(subject)) return undefined;
  return resolveUnder(join(home.root, "subjects", subject, folder), path);
}

async function servePage(c: Context, home: LearningHome, tool: ToolDirs, folder: ContextFolder) {
  const requested = c.req.param("file")!;
  const file = await resolvePage(c, home, folder, requested);
  if (!file || !contentTypeOf(file).startsWith("text/html")) return sendFile(c, file);
  const hasTheme = (await resolveThemeFile(home, tool, DEFAULT_THEME, "tokens.css")) !== undefined;
  const html = injectPage(await readFile(file, "utf8"), {
    themeCss: hasTheme ? `/themes/${DEFAULT_THEME}/tokens.css` : undefined,
    subject: c.req.param("subject")!,
    kind: CONTEXT_PAGES[folder],
    id: basename(requested, extname(requested)),
  });
  return c.body(html, 200, { "content-type": contentTypeOf(file) });
}

export function pageRoutes(home: () => LearningHome, tool: ToolDirs): Hono {
  const routes = new Hono();
  for (const folder of Object.keys(CONTEXT_PAGES) as ContextFolder[]) {
    routes.get(`/:subject/${folder}/:file`, (c) => servePage(c, home(), tool, folder));
  }
  routes.get("/:subject/reference/:file", async (c) =>
    sendFile(c, await resolvePage(c, home(), "reference", c.req.param("file"))),
  );
  routes.get("/:subject/assets/:path{.+}", async (c) =>
    sendFile(c, await resolvePage(c, home(), "assets", c.req.param("path"))),
  );
  return routes;
}
