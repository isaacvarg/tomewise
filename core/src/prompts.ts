import { type LearningEvent, parseRef } from "./events.ts";
import { examsOn, milestoneStatusesOf } from "./milestones.ts";
import { dueQuiz, type QuizSlot } from "./quiz-due.ts";
import type { Subject } from "./subject.ts";

export interface PromptMilestone {
  id: string;
  title: string;
}

export type AgentPrompt =
  | { kind: "milestone-done"; milestone: PromptMilestone; say: string }
  | { kind: "exam-unwritten"; milestone: PromptMilestone; exam: string; say: string }
  | { kind: "exam-ready"; milestone: PromptMilestone; exam: string; say: string }
  | { kind: "quiz-unwritten"; quiz: QuizSlot; say: string }
  | { kind: "ungraded-explanations"; count: number; refs: string[]; say: string };

export interface Grade {
  id: string;
  ts: string;
  feedback: string;
  outcome?: LearningEvent["outcome"];
}

export interface Explanation {
  id: string;
  ts: string;
  ref: string;
  text: string;
  grade?: Grade;
}

const FINISHED = new Set(["done", "skipped"]);

export function explanations(events: readonly LearningEvent[]): Explanation[] {
  const grades = new Map<string, Grade>();
  for (const event of events) {
    const ref = event.kind === "explanation.graded" && event.ref !== undefined ? parseRef(event.ref) : undefined;
    if (ref?.kind !== "event") continue;
    const feedback = String(event.data?.feedback ?? "");
    grades.set(ref.id, { id: event.id, ts: event.ts, feedback, ...(event.outcome !== undefined && { outcome: event.outcome }) });
  }
  return events
    .filter((event) => event.kind === "explanation.saved" && event.ref !== undefined)
    .map((event): Explanation => {
      const grade = grades.get(event.id);
      return { id: event.id, ts: event.ts, ref: event.ref!, text: String(event.data?.text ?? ""), ...(grade && { grade }) };
    })
    .reverse();
}

function milestonePrompt(subject: Subject, milestone: NonNullable<Subject["curriculum"]>["units"][number]["milestones"][number]): AgentPrompt {
  const named = { id: milestone.id, title: milestone.title };
  if (milestone.exam === undefined || !examsOn(subject.settings.assessments)) {
    return { kind: "milestone-done", milestone: named, say: `Mark the “${milestone.title}” milestone done.` };
  }
  if (subject.exams.includes(milestone.exam)) {
    return { kind: "exam-ready", milestone: named, exam: milestone.exam, say: `Go over my exam results for “${milestone.title}”.` };
  }
  return { kind: "exam-unwritten", milestone: named, exam: milestone.exam, say: `Prepare the exam for “${milestone.title}”.` };
}

export function agentPrompts(subject: Subject, events: readonly LearningEvent[], now = new Date()): AgentPrompt[] {
  const done = new Set<string>();
  for (const event of events) {
    const ref = event.kind === "lesson.completed" && event.ref !== undefined ? parseRef(event.ref) : undefined;
    if (ref?.kind === "lesson") done.add(ref.id);
  }
  const statuses = milestoneStatusesOf(subject, events);
  const prompts = (subject.curriculum?.units ?? [])
    .flatMap((unit) => unit.milestones)
    .filter((milestone) => !FINISHED.has(statuses[milestone.id]!) && milestone.lessons.length > 0 && milestone.lessons.every((id) => done.has(id)))
    .map((milestone) => milestonePrompt(subject, milestone));
  const quiz = dueQuiz(subject, events, now);
  if (quiz && quiz.quiz === undefined) prompts.push({ kind: "quiz-unwritten", quiz, say: `Write the ${subject.name} quiz that's due.` });
  const ungraded = explanations(events)
    .filter((explanation) => explanation.grade === undefined)
    .reverse();
  const refs = [...new Set(ungraded.map((explanation) => explanation.ref))];
  if (refs.length > 0) {
    const noun = ungraded.length === 1 ? "explanation" : "explanations";
    prompts.push({ kind: "ungraded-explanations", count: ungraded.length, refs, say: `Grade my ${subject.name} ${noun}.` });
  }
  return prompts;
}
