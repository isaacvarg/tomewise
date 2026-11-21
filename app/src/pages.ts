import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Hono, type Context } from "hono";
import type { LearningHome } from "@tomewise/core";
import { contentTypeOf, resolveUnder, sendFile } from "./files.ts";
import { injectLesson } from "./inject.ts";
import { resolveThemeFile, type ToolDirs } from "./tool-files.ts";

const PAGE_FOLDERS = ["lessons", "quizzes", "exams", "reference"] as const;
type PageFolder = (typeof PAGE_FOLDERS)[number] | "assets";

const DEFAULT_THEME = "paper";

async function resolvePage(c: Context, home: LearningHome, folder: PageFolder, path: string) {
  const subject = c.req.param("subject")!;
  if (!home.subjects.includes(subject)) return undefined;
  return resolveUnder(join(home.root, "subjects", subject, folder), path);
}

async function serveLesson(c: Context, home: LearningHome, tool: ToolDirs) {
  const requested = c.req.param("file")!;
  const file = await resolvePage(c, home, "lessons", requested);
  if (!file || !contentTypeOf(file).startsWith("text/html")) return sendFile(c, file);
  const hasTheme = (await resolveThemeFile(home, tool, DEFAULT_THEME, "tokens.css")) !== undefined;
  const html = injectLesson(await readFile(file, "utf8"), {
    themeCss: hasTheme ? `/themes/${DEFAULT_THEME}/tokens.css` : undefined,
    subject: c.req.param("subject")!,
    lesson: basename(requested, extname(requested)),
  });
  return c.body(html, 200, { "content-type": contentTypeOf(file) });
}

export function pageRoutes(home: LearningHome, tool: ToolDirs): Hono {
  const routes = new Hono();
  routes.get("/:subject/lessons/:file", (c) => serveLesson(c, home, tool));
  for (const folder of PAGE_FOLDERS.filter((folder) => folder !== "lessons")) {
    routes.get(`/:subject/${folder}/:file`, async (c) => sendFile(c, await resolvePage(c, home, folder, c.req.param("file"))));
  }
  routes.get("/:subject/assets/:path{.+}", async (c) =>
    sendFile(c, await resolvePage(c, home, "assets", c.req.param("path"))),
  );
  return routes;
}
