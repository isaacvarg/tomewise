import { type Context, Hono } from "hono";
import { dueItems, readActivity, readEvents, SubjectNotFoundError } from "@tomewise/core";
import type { HomeView } from "./watcher.ts";

function query(c: Context, name: string): string | undefined {
  return c.req.query(name) || undefined;
}

function subjectOf(view: HomeView, id: string) {
  const subject = view.subjects.get(id);
  if (subject) return subject;
  const ids = [...view.subjects.keys()];
  throw new SubjectNotFoundError(`No subject "${id}" in ${view.home.root}. Subjects: ${ids.join(", ") || "none"}`);
}

export function readRoutes(view: () => HomeView, now: () => Date = () => new Date()): Hono {
  const routes = new Hono();

  routes.get("/subjects", (c) => c.json({ subjects: [...view().subjects.values()] }));

  routes.get("/subjects/:subject", (c) => c.json(subjectOf(view(), c.req.param("subject"))));

  routes.get("/subjects/:subject/events", async (c) => {
    const range = { from: query(c, "from"), to: query(c, "to") };
    return c.json({ events: await readEvents(view().home, c.req.param("subject"), range) });
  });

  routes.get("/subjects/:subject/due", async (c) =>
    c.json({ due: await dueItems(view().home, c.req.param("subject"), query(c, "date") ?? now()) }),
  );

  routes.get("/activity", async (c) =>
    c.json(await readActivity(view().home, { now: now(), from: query(c, "from"), to: query(c, "to") })),
  );

  routes.onError((error, c) => {
    if (error instanceof SubjectNotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof RangeError) return c.json({ error: error.message }, 400);
    throw error;
  });

  return routes;
}
