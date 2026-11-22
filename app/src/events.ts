import { Hono } from "hono";
import { appendEvents, InvalidEventError, type LearningHome } from "@tomewise/core";
import type { GitSync } from "./sync.ts";

export function eventRoutes(home: () => LearningHome, sync: GitSync): Hono {
  const routes = new Hono();

  routes.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      return c.json({ issues: [{ file: "request", path: "", message: `Invalid JSON: ${(error as Error).message}` }] }, 400);
    }
    const inputs = Array.isArray(body) ? body : [body];
    if (inputs.length === 0) return c.json({ issues: [{ file: "request", path: "", message: "No events" }] }, 400);
    try {
      const appended = await sync.exclusive(() => appendEvents(home(), inputs, { target: "main" }));
      const events = appended.map(({ event }) => event);
      sync.recorded(events);
      return c.json({ events }, 201);
    } catch (error) {
      if (error instanceof InvalidEventError) return c.json({ issues: error.issues }, 400);
      throw error;
    }
  });

  return routes;
}
