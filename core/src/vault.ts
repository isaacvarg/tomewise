import { CURRICULUM_COPY_FILE, writeCurriculumCopies } from "./curriculum-copy.ts";
import { assertVaultMode, writeGeneratedFiles, type WrittenFiles } from "./generated-files.ts";
import type { LearningHome } from "./load.ts";
import { notesFolder, sessionNotes, type SessionNote } from "./session-notes.ts";
import { SESSIONS_BASE_FILE, writeSessionsBase } from "./sessions-base.ts";
import { subjectPath } from "./subject.ts";

export interface VaultRebuild extends WrittenFiles {
  curricula: WrittenFiles;
}

export function generatedFileGlobs(home: LearningHome): string[] {
  const folder = notesFolder(home).replace(/[*?[\]]/g, "\\$&");
  return [`${folder}/**/*.md`, `subjects/*/${CURRICULUM_COPY_FILE}`, SESSIONS_BASE_FILE];
}

export async function rebuildVault(home: LearningHome): Promise<VaultRebuild> {
  assertVaultMode(home);
  const notes: SessionNote[] = [];
  for (const subject of home.subjects) notes.push(...(await sessionNotes(home, subject)));
  const written = await writeGeneratedFiles(home, notes);
  const base = await writeSessionsBase(home);
  const curricula = await writeCurriculumCopies(home, home.subjects);
  return { written: [...written.written, ...base.written], leftAlone: [...written.leftAlone, ...base.leftAlone], curricula };
}

export async function regenerateVaultFiles(home: LearningHome, paths: ReadonlySet<string>): Promise<void> {
  if (!home.config.vault.enabled || paths.size === 0) return;
  const notes: SessionNote[] = [];
  for (const subject of home.subjects) notes.push(...(await sessionNotes(home, subject)).filter((note) => paths.has(note.path)));
  await writeGeneratedFiles(home, notes);
  const copies = home.subjects.filter((subject) => paths.has(subjectPath(subject, CURRICULUM_COPY_FILE)));
  if (copies.length > 0) await writeCurriculumCopies(home, copies);
  if (paths.has(SESSIONS_BASE_FILE)) await writeSessionsBase(home);
}
