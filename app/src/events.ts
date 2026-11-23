import { Hono } from "hono";
import { appendEvents, closeExams, InvalidEventError, type LearningEvent, type LearningHome, writeSessionNote } from "@tomewise/core";
import type { Changes } from "./changes.ts";
import type { GitSync } from "./sync.ts";
import type { Warn } from "./themes.ts";

export function eventRoutes(home: () => LearningHome, sync: GitSync, changes: Changes, warn: Warn): Hono {
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
      const { events, exams, quizzes } = await sync.exclusive(async () => {
        const closed = await closeExams(home(), inputs);
        const appended = await appendEvents(home(), closed.inputs, { target: "main" });
        const events = appended.map(({ event }) => event);
        await writeEndedSessionNotes(home(), events, warn);
        return { events, exams: closed.exams, quizzes: closed.quizzes };
      });
      sync.recorded(events);
      changes.announce({ kind: "events", subjects: [...new Set(events.map((event) => event.subject))] });
      return c.json({ events, ...(exams.length > 0 && { exams }), ...(quizzes.length > 0 && { quizzes }) }, 201);
    } catch (error) {
      if (error instanceof InvalidEventError) return c.json({ issues: error.issues }, 400);
      throw error;
    }
  });

  return routes;
}

async function writeEndedSessionNotes(home: LearningHome, events: readonly LearningEvent[], warn: Warn): Promise<void> {
  if (!home.config.vault.enabled) return;
  for (const event of events) {
    if (event.kind !== "session.end") continue;
    try {
      await writeSessionNote(home, event.subject, event.sessionId!);
    } catch (error) {
      warn(`Couldn't write the session note for ${event.sessionId}: ${(error as Error).message}`);
    }
  }
}
