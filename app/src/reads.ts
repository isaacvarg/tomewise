import { type Context, Hono } from "hono";
import { agentPrompts, completedLessons, dueItems, explanations, readActivity, readEvents, SubjectNotFoundError } from "@tomewise/core";
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

  routes.get("/subjects/:subject/progress", async (c) =>
    c.json({ completedLessons: await completedLessons(view().home, c.req.param("subject")) }),
  );

  routes.get("/subjects/:subject/prompts", async (c) => {
    const current = view();
    const subject = subjectOf(current, c.req.param("subject"));
    const events = await readEvents(current.home, subject.id);
    return c.json({ prompts: agentPrompts(subject, events), explanations: explanations(events) });
  });

  routes.get("/prompts", async (c) => {
    const { home, subjects } = view();
    const all = await Promise.all(
      [...subjects.values()].map(async (subject) => ({ subject: subject.id, prompts: agentPrompts(subject, await readEvents(home, subject.id)) })),
    );
    return c.json({ subjects: all.filter((entry) => entry.prompts.length > 0) });
  });

  routes.get("/activity", async (c) => {
    const subject = query(c, "subject");
    if (subject !== undefined) subjectOf(view(), subject);
    return c.json(await readActivity(view().home, { now: now(), subject, from: query(c, "from"), to: query(c, "to") }));
  });

  routes.onError((error, c) => {
    if (error instanceof SubjectNotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof RangeError) return c.json({ error: error.message }, 400);
    throw error;
  });

  return routes;
}
