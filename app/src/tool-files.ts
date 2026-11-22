import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { LearningHome } from "@tomewise/core";
import { isDirectory, isSafeSegment, resolveUnder, sendFile } from "./files.ts";

export interface ToolDirs {
  widgets: string;
  themes: string;
}

export const BUILT_IN: ToolDirs = {
  widgets: fileURLToPath(new URL("../../widgets/", import.meta.url)),
  themes: fileURLToPath(new URL("../../themes/", import.meta.url)),
};

export async function resolveThemeFile(
  home: LearningHome,
  tool: ToolDirs,
  name: string,
  path: string,
): Promise<string | undefined> {
  if (!isSafeSegment(name)) return undefined;
  const own = join(home.root, "themes", name);
  return resolveUnder((await isDirectory(own)) ? own : join(tool.themes, name), path);
}

export function widgetRoutes(tool: ToolDirs): Hono {
  const routes = new Hono();
  routes.get("/:path{.+}", async (c) => sendFile(c, await resolveUnder(tool.widgets, c.req.param("path"))));
  return routes;
}

export function themeRoutes(home: () => LearningHome, tool: ToolDirs): Hono {
  const routes = new Hono();
  routes.get("/:name/:path{.+}", async (c) =>
    sendFile(c, await resolveThemeFile(home(), tool, c.req.param("name"), c.req.param("path"))),
  );
  return routes;
}
