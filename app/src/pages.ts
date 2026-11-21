import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { Hono, type Context } from "hono";
import type { LearningHome } from "@tomewise/core";

const PAGE_FOLDERS = ["lessons", "quizzes", "exams", "reference"] as const;
type PageFolder = (typeof PAGE_FOLDERS)[number] | "assets";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
};

const NOT_FOUND = new Set(["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"]);

function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function resolvePage(
  home: LearningHome,
  subject: string,
  folder: PageFolder,
  path: string,
): Promise<string | undefined> {
  if (!home.subjects.includes(subject)) return undefined;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || /[\\\0]/.test(segment))) {
    return undefined;
  }
  const base = join(home.root, "subjects", subject, folder);
  try {
    const [realBase, realFile] = await Promise.all([realpath(base), realpath(join(base, ...segments))]);
    if (!realFile.startsWith(realBase + sep)) return undefined;
    if (!(await stat(realFile)).isFile()) return undefined;
    return realFile;
  } catch (error) {
    if (NOT_FOUND.has((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw error;
  }
}

async function serve(c: Context, home: LearningHome, folder: PageFolder, path: string) {
  const file = await resolvePage(home, c.req.param("subject")!, folder, path);
  if (!file) return c.notFound();
  return c.body(new Uint8Array(await readFile(file)), 200, { "content-type": contentTypeOf(file) });
}

export function pageRoutes(home: LearningHome): Hono {
  const routes = new Hono();
  for (const folder of PAGE_FOLDERS) {
    routes.get(`/:subject/${folder}/:file`, (c) => serve(c, home, folder, c.req.param("file")));
  }
  routes.get("/:subject/assets/:path{.+}", (c) => serve(c, home, "assets", c.req.param("path")));
  return routes;
}
