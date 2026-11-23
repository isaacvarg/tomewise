import { type MilestoneStatus, milestoneStatus } from "./curriculum.ts";
import { type LearningEvent, parseRef } from "./events.ts";
import type { Subject } from "./subject.ts";

export function milestoneStatusesOf(subject: Pick<Subject, "curriculum">, events: readonly LearningEvent[]): Record<string, MilestoneStatus> {
  const statuses: Record<string, MilestoneStatus> = {};
  for (const milestone of subject.curriculum?.units.flatMap((unit) => unit.milestones) ?? []) statuses[milestone.id] = milestone.status;
  for (const event of events) {
    const ref = event.kind === "milestone.status" && event.ref !== undefined ? parseRef(event.ref) : undefined;
    const status = milestoneStatus.safeParse(event.data?.status);
    if (ref?.kind === "milestone" && ref.id in statuses && status.success) statuses[ref.id] = status.data;
  }
  return statuses;
}
