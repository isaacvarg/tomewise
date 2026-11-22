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

interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
}

export interface EntryAssets {
  script: string;
  styles: string[];
}

export async function entryAssets(root: string, entry: string): Promise<EntryAssets | undefined> {
  let manifest: Record<string, ManifestChunk>;
  try {
    manifest = JSON.parse(await readFile(join(root, ".vite/manifest.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const chunk = manifest[entry];
  if (!chunk) return undefined;
  const styles = new Set<string>();
  const seen = new Set<string>();
  const collect = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const { css = [], imports = [] } = manifest[key] ?? { css: [] };
    imports.forEach(collect);
    for (const file of css) styles.add(`/${file}`);
  };
  collect(entry);
  return { script: `/${chunk.file}`, styles: [...styles] };
}
