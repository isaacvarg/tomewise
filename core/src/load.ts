import { readConfig } from "./config.ts";
import { InvalidLearningHomeError, SubjectNotFoundError, UnsupportedFormatVersionError } from "./errors.ts";
import type { TomewiseConfig } from "./schemas.ts";
import { listSubjects, readSubject, withSettings, type Subject } from "./subject.ts";

export interface LearningHome {
  root: string;
  config: TomewiseConfig;
  subjects: string[];
}

export async function loadLearningHome(root: string): Promise<LearningHome> {
  const read = await readConfig(root);
  switch (read.kind) {
    case "ok":
      return { root, config: read.config, subjects: await listSubjects(root) };
    case "too-new":
      throw new UnsupportedFormatVersionError(read.issue.message);
    case "invalid":
      throw new InvalidLearningHomeError(read.issues);
  }
}

export async function loadSubject(home: LearningHome, id: string): Promise<Subject> {
  if (!home.subjects.includes(id)) {
    throw new SubjectNotFoundError(`No subject "${id}" in ${home.root}. Subjects: ${home.subjects.join(", ") || "none"}`);
  }
  const read = await readSubject(home.root, id);
  if (!read.content || read.issues.length > 0) throw new InvalidLearningHomeError(read.issues);
  return withSettings(read.content, home.config);
}
