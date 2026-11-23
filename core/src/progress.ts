import { readEvents } from "./event-store.ts";
import { parseRef } from "./events.ts";
import type { LearningHome } from "./load.ts";

export async function completedLessons(home: LearningHome, subjectId: string): Promise<string[]> {
  const events = await readEvents(home, subjectId);
  const completed = new Set<string>();
  for (const event of events) {
    if (event.kind !== "lesson.completed" || event.ref === undefined) continue;
    const ref = parseRef(event.ref);
    if (ref?.kind === "lesson") completed.add(ref.id);
  }
  return [...completed];
}
