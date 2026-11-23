import { isDeepStrictEqual } from "node:util";
import { type LearningEvent, type LearningHome, writeCurriculumCopies } from "@tomewise/core";
import type { WatchedHome } from "./watcher.ts";

export type OnError = (error: unknown) => void;

export const logCopyError: OnError = (error) => console.error("Writing a curriculum copy failed:", error);

export async function copyCurricula(home: LearningHome, subjects: Iterable<string>, onError: OnError): Promise<void> {
  const ids = [...new Set(subjects)];
  if (!home.config.vault.enabled || ids.length === 0) return;
  await writeCurriculumCopies(home, ids).then(() => undefined, onError);
}

export const milestoneSubjects = (events: readonly LearningEvent[]): string[] =>
  events.filter((event) => event.kind === "milestone.status").map((event) => event.subject);

export async function copyCurriculaOnChange(watched: WatchedHome, onError: OnError): Promise<void> {
  watched.onReload((next, previous) => {
    const vaultTurnedOn = !previous.home.config.vault.enabled;
    const changed = [...next.subjects]
      .filter(([id, subject]) => vaultTurnedOn || !isDeepStrictEqual(subject.curriculum, previous.subjects.get(id)?.curriculum))
      .map(([id]) => id);
    return copyCurricula(next.home, changed, onError);
  });
  const { home } = watched.current();
  await copyCurricula(home, home.subjects, onError);
}
