import { readConfig } from "./config.ts";
import { checkAgainstSubject, historyOf } from "./event-checks.ts";
import { monthOf, scanEvents } from "./event-store.ts";
import type { ValidationIssue } from "./issues.ts";
import { lessonIssues } from "./lesson-checks.ts";
import { subjectOrderIssues } from "./references.ts";
import { listSubjects, readSubject, type SubjectContent } from "./subject.ts";

async function eventIssues(root: string, id: string, subject: SubjectContent | undefined): Promise<ValidationIssue[]> {
  const scan = await scanEvents(root, id);
  const issues: ValidationIssue[] = [
    ...scan.otherFiles.map((file) => ({
      file,
      path: "",
      message: "Not an event file; name it YYYY-MM.jsonl or YYYY-MM.<machine>.jsonl",
    })),
    ...scan.issues,
  ];
  const history = historyOf(scan.lines.map((line) => line.event));
  const firstAt = new Map<string, string>();
  for (const { event, file, fileMonth, line } of scan.lines) {
    const at = (path: string, message: string) => issues.push({ file, line, path, message });
    const seen = firstAt.get(event.id);
    if (seen) at("id", `Duplicate event id "${event.id}"; first used in ${seen}`);
    else firstAt.set(event.id, `${file}:${line}`);
    if (event.subject !== id) at("subject", `This event is filed under subject "${id}"`);
    if (monthOf(event.ts) !== fileMonth) at("ts", `This event is from ${monthOf(event.ts)} but is in a ${fileMonth} file`);
    if (subject) for (const issue of checkAgainstSubject(event, subject, history)) at(issue.path, issue.message);
  }
  return issues;
}

export async function validateLearningHome(root: string): Promise<ValidationIssue[]> {
  const read = await readConfig(root);
  if (read.kind === "too-new") return [read.issue];
  const subjects = await listSubjects(root);
  const issues = read.kind === "invalid" ? [...read.issues] : subjectOrderIssues(read.config.subjects, subjects);
  for (const id of subjects) {
    const subject = await readSubject(root, id);
    issues.push(...subject.issues, ...(await eventIssues(root, id, subject.content)));
    if (subject.content) issues.push(...(await lessonIssues(root, id, subject.content.lessons)));
  }
  return issues;
}
