import type { LearningEvent, Ref } from "./events.ts";
import { parseRef } from "./events.ts";
import { issuesFrom, type ValidationIssue } from "./issues.ts";
import { dataSchema } from "./payload.ts";
import { explanationText, ruleChanges } from "./schemas.ts";
import { subjectPath, type Subject } from "./subject.ts";

type SubjectRefs = Omit<Subject, "settings">;

export interface History {
  byId: Map<string, LearningEvent>;
}

export function historyOf(events: Iterable<LearningEvent>): History {
  const byId = new Map<string, LearningEvent>();
  for (const event of events) if (!byId.has(event.id)) byId.set(event.id, event);
  return { byId };
}

type Issue = Omit<ValidationIssue, "file">;

function missingRef(subject: SubjectRefs, ref: Ref, history: History): string | undefined {
  const where = (dir: string) => `No ${ref.kind} "${ref.id}" in ${subjectPath(subject.id, dir)}`;
  switch (ref.kind) {
    case "item":
      return subject.items.some((item) => item.id === ref.id) ? undefined : where("items");
    case "lesson":
      return subject.lessons.includes(ref.id) ? undefined : where("lessons");
    case "drill":
      return subject.drills.some((drill) => drill.id === ref.id) ? undefined : where("drills");
    case "quiz":
      return subject.quizzes.includes(ref.id) ? undefined : where("quizzes");
    case "exam":
      return subject.exams.includes(ref.id) ? undefined : where("exams");
    case "milestone": {
      const milestones = subject.curriculum?.units.flatMap((unit) => unit.milestones) ?? [];
      return milestones.some((milestone) => milestone.id === ref.id) ? undefined : where("curriculum.json");
    }
    case "event":
      return history.byId.has(ref.id) ? undefined : where("events");
  }
}

export function checkAgainstSubject(event: LearningEvent, subject: SubjectRefs, history: History): Issue[] {
  const issues: Issue[] = [];
  const ref = event.ref === undefined ? undefined : parseRef(event.ref);
  if (ref) {
    const missing = missingRef(subject, ref, history);
    if (missing) issues.push({ path: "ref", message: missing });
    else if (event.kind === "explanation.graded" && history.byId.get(ref.id)?.kind !== "explanation.saved") {
      issues.push({ path: "ref", message: "An explanation.graded refers to an explanation.saved event" });
    }
  }
  const version = subject.payloadSchemas.find((v) => v.version === event.schemaVersion);
  if (!version) {
    issues.push({
      path: "schemaVersion",
      message: `Subject ${subject.id} has payload schema versions ${subject.payloadSchemas.map((v) => v.version).join(", ")}`,
    });
  } else {
    const declared = dataSchema(version, event.kind);
    const schema =
      event.kind in ruleChanges
        ? ruleChanges[event.kind as keyof typeof ruleChanges]
        : event.kind === "explanation.saved"
          ? declared.extend({ text: explanationText })
          : declared;
    const data = schema.safeParse(event.data);
    if (!data.success) issues.push(...issuesFrom("", data.error, ["data"]).map(({ file: _, ...issue }) => issue));
  }
  if (event.sessionId !== undefined && event.kind !== "session.start") {
    if (history.byId.get(event.sessionId)?.kind !== "session.start") {
      issues.push({
        path: "sessionId",
        message: `No session.start with id "${event.sessionId}" in ${subjectPath(subject.id, "events")}`,
      });
    }
  }
  return issues;
}
