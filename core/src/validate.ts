import { readConfig } from "./config.ts";
import type { ValidationIssue } from "./issues.ts";

export async function validateLearningHome(root: string): Promise<ValidationIssue[]> {
  const read = await readConfig(root);
  switch (read.kind) {
    case "ok":
      return [];
    case "too-new":
      return [read.issue];
    case "invalid":
      return read.issues;
  }
}
