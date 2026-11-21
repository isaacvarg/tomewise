import { formatIssue, type ValidationIssue } from "./issues.ts";

export class LearningHomeNotFoundError extends Error {
  override name = "LearningHomeNotFoundError";
}

export class GlobalConfigError extends Error {
  override name = "GlobalConfigError";
}

export class UnsupportedFormatVersionError extends Error {
  override name = "UnsupportedFormatVersionError";
}

export class InvalidLearningHomeError extends Error {
  override name = "InvalidLearningHomeError";
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(["The learning home has problems:", ...issues.map((i) => `  ${formatIssue(i)}`)].join("\n"));
    this.issues = issues;
  }
}
