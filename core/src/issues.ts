import type { z } from "zod";

export interface ValidationIssue {
  file: string;
  path: string;
  message: string;
}

export function formatIssue(issue: ValidationIssue): string {
  return issue.path ? `${issue.file}: ${issue.path}: ${issue.message}` : `${issue.file}: ${issue.message}`;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((key, i) => (typeof key === "number" ? `[${key}]` : i === 0 ? String(key) : `.${String(key)}`))
    .join("");
}

export function issuesFrom(file: string, error: z.ZodError, prefix: readonly PropertyKey[] = []): ValidationIssue[] {
  return error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys"
      ? issue.keys.map((key) => ({ file, path: formatPath([...prefix, ...issue.path, key]), message: "Unknown field" }))
      : [{ file, path: formatPath([...prefix, ...issue.path]), message: issue.message }],
  );
}
