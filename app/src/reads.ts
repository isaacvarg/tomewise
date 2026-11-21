import { type Context, Hono } from "hono";
import { dueItems, type LearningHome, loadSubject, readActivity, readEvents, SubjectNotFoundError } from "@tomewise/core";

function query(c: Context, name: string): string | undefined {
  return c.req.query(name) || undefined;
}

export function readRoutes(home: LearningHome): Hono {
  const routes = new Hono();

  routes.get("/subjects", async (c) =>
    c.json({ subjects: await Promise.all(home.subjects.map((id) => loadSubject(home, id))) }),
  );

  routes.get("/subjects/:subject", async (c) => c.json(await loadSubject(home, c.req.param("subject"))));

  routes.get("/subjects/:subject/events", async (c) => {
    const range = { from: query(c, "from"), to: query(c, "to") };
    return c.json({ events: await readEvents(home, c.req.param("subject"), range) });
  });

  routes.get("/subjects/:subject/due", async (c) =>
    c.json({ due: await dueItems(home, c.req.param("subject"), query(c, "date") ?? new Date()) }),
  );

  routes.get("/activity", async (c) => c.json(await readActivity(home, { from: query(c, "from"), to: query(c, "to") })));

  routes.onError((error, c) => {
    if (error instanceof SubjectNotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof RangeError) return c.json({ error: error.message }, 400);
    throw error;
  });

  return routes;
}
