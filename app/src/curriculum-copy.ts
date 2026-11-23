import { isDeepStrictEqual } from "node:util";
import { type LearningEvent, type LearningHome, writeCurriculumCopies } from "@tomewise/core";
import type { Warn } from "./themes.ts";
import type { WatchedHome } from "./watcher.ts";

export async function copyCurricula(home: LearningHome, subjects: Iterable<string>, warn: Warn): Promise<void> {
  const ids = [...new Set(subjects)];
  if (!home.config.vault.enabled || ids.length === 0) return;
  try {
    await writeCurriculumCopies(home, ids);
  } catch (error) {
    warn(`Couldn't write the curriculum copy for ${ids.join(", ")}: ${(error as Error).message}`);
  }
}

export const milestoneSubjects = (events: readonly LearningEvent[]): string[] =>
  events.filter((event) => event.kind === "milestone.status").map((event) => event.subject);

export async function copyCurriculaOnChange(watched: WatchedHome, warn: Warn): Promise<void> {
  watched.onReload((next, previous) => {
    const vaultTurnedOn = !previous.home.config.vault.enabled;
    const changed = [...next.subjects]
      .filter(([id, subject]) => vaultTurnedOn || !isDeepStrictEqual(subject.curriculum, previous.subjects.get(id)?.curriculum))
      .map(([id]) => id);
    return copyCurricula(next.home, changed, warn);
  });
  const { home } = watched.current();
  await copyCurricula(home, home.subjects, warn);
}
