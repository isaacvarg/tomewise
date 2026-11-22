import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import type { LearningHome } from "@tomewise/core";
import { injectTheme } from "./inject.ts";
import type { ResolveTheme } from "./themes.ts";

export const BUILT_SPA = fileURLToPath(new URL("../dist/", import.meta.url));

function isClientRoute(path: string): boolean {
  if (path === "/api" || path.startsWith("/api/")) return false;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return !last.includes(".");
}

export function spaRoutes(root: string, home: () => LearningHome, resolveTheme: ResolveTheme): Hono {
  const routes = new Hono();
  const index = async (c: Context) => {
    let html: string;
    try {
      html = await readFile(join(root, "index.html"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return c.notFound();
      throw error;
    }
    return c.html(injectTheme(html, await resolveTheme(home())));
  };
  routes.get("/", index);
  routes.get("/index.html", index);
  routes.get("*", serveStatic({ root }));
  routes.get("*", async (c) => (isClientRoute(c.req.path) ? index(c) : c.notFound()));
  return routes;
}
