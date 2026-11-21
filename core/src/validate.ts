import { readConfig } from "./config.ts";
import type { ValidationIssue } from "./issues.ts";
import { listSubjects, readSubject } from "./subject.ts";

export async function validateLearningHome(root: string): Promise<ValidationIssue[]> {
  const read = await readConfig(root);
  if (read.kind === "too-new") return [read.issue];
  const issues = read.kind === "invalid" ? [...read.issues] : [];
  for (const id of await listSubjects(root)) issues.push(...(await readSubject(root, id)).issues);
  return issues;
}
