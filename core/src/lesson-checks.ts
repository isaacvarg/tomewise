import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ValidationIssue } from "./issues.ts";
import { subjectPath } from "./subject.ts";

const BLANKED = /<!--[\s\S]*?-->|<tome-exam-question\b[\s\S]*?<\/tome-exam-question\s*>/gi;
const ITEM_WIDGET = /<(tome-(?:flashcard|choice|typed|audio))\b([^>]*)>\s*(?:<\/\1\s*>)?/gi;
const REF = /\bref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

export const STACK_LIMIT = 3;

interface Placed {
  ref: string | undefined;
  start: number;
  end: number;
}

function widgetsIn(html: string): Placed[] {
  const page = html.replace(BLANKED, (block) => block.replace(/[^\n]/g, " "));
  return [...page.matchAll(ITEM_WIDGET)].map((match) => {
    const ref = REF.exec(match[2]!);
    return { ref: ref?.[1] ?? ref?.[2] ?? ref?.[3], start: match.index, end: match.index + match[0].length };
  });
}

export function stackedWidgetIssues(file: string, html: string): ValidationIssue[] {
  const widgets = widgetsIn(html);
  const lineOf = (offset: number) => html.slice(0, offset).split("\n").length;
  const issues: ValidationIssue[] = [];
  const advise = (at: Placed, message: string) => issues.push({ file, line: lineOf(at.start), path: "", message, advice: true });

  let run: Placed[] = [];
  const stacked = new Set<Placed>();
  const close = () => {
    if (run.length >= STACK_LIMIT) {
      for (const widget of run) stacked.add(widget);
      const ids = [...new Set(run.flatMap((widget) => (widget.ref ? [widget.ref.replace(/^item:/, "")] : [])))].join(" ");
      advise(
        run[0]!,
        `${run.length} item widgets in a row; show them one at a time with one <tome-drill items="${ids}">, or put the teaching each one belongs to between them`,
      );
    }
    run = [];
  };
  for (const widget of widgets) {
    const previous = run.at(-1);
    if (previous && html.slice(previous.end, widget.start).trim() !== "") close();
    run.push(widget);
  }
  close();

  const asked = new Map<string, Placed[]>();
  for (const widget of widgets) if (widget.ref) asked.set(widget.ref, [...(asked.get(widget.ref) ?? []), widget]);
  for (const [ref, places] of asked) {
    if (places.length < 2 || places.some((place) => stacked.has(place))) continue;
    advise(
      places[1]!,
      `${ref} has ${places.length} widgets on this page; ask it once, and repeat it with <tome-drill items="${ref.replace(/^item:/, "")}" count="${places.length}">`,
    );
  }
  return issues.sort((a, b) => a.line! - b.line!);
}

export async function lessonIssues(root: string, subject: string, lessons: readonly string[]): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const lesson of lessons) {
    const file = subjectPath(subject, "lessons", `${lesson}.html`);
    issues.push(...stackedWidgetIssues(file, await readFile(join(root, file), "utf8")));
  }
  return issues;
}
