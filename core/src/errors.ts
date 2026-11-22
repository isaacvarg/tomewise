import { formatIssue, type ValidationIssue } from "./issues.ts";

export class LearningHomeNotFoundError extends Error {
  override name = "LearningHomeNotFoundError";
}

export class GlobalConfigError extends Error {
  override name = "GlobalConfigError";
}

export class SubjectNotFoundError extends Error {
  override name = "SubjectNotFoundError";
}

export class QueryError extends Error {
  override name = "QueryError";
}

export class UnsupportedFormatVersionError extends Error {
  override name = "UnsupportedFormatVersionError";
}

abstract class IssuesError extends Error {
  readonly issues: ValidationIssue[];

  constructor(heading: string, issues: ValidationIssue[]) {
    super([heading, ...issues.map((i) => `  ${formatIssue(i)}`)].join("\n"));
    this.issues = issues;
  }
}

export class InvalidLearningHomeError extends IssuesError {
  override name = "InvalidLearningHomeError";

  constructor(issues: ValidationIssue[]) {
    super("The learning home has problems:", issues);
  }
}

export class InvalidEventError extends IssuesError {
  override name = "InvalidEventError";

  constructor(issues: ValidationIssue[]) {
    super("The event was not logged:", issues);
  }
}
