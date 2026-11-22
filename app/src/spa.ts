import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

export const BUILT_SPA = fileURLToPath(new URL("../dist/", import.meta.url));

function isClientRoute(path: string): boolean {
  if (path === "/api" || path.startsWith("/api/")) return false;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return !last.includes(".");
}

export function spaRoutes(root: string): Hono {
  const routes = new Hono();
  routes.get("*", serveStatic({ root }));
  routes.get("*", async (c, next) => (isClientRoute(c.req.path) ? next() : c.notFound()));
  routes.get("*", serveStatic({ root, path: "index.html" }));
  return routes;
}
