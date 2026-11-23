import { z } from "zod";
import { Id } from "./items.ts";

export const milestoneStatuses = ["done", "current", "upcoming", "skipped", "changed"] as const;

export type MilestoneStatus = (typeof milestoneStatuses)[number];

export const milestoneStatus = z.enum(milestoneStatuses, { error: `Use a milestone status: ${milestoneStatuses.join(", ")}` });

const Milestone = z.strictObject({
  id: Id,
  title: z.string().min(1),
  status: milestoneStatus,
  lessons: z.array(z.string().min(1)).default([]),
  exam: z.string().min(1).optional(),
});

export const Curriculum = z.strictObject({
  units: z.array(
    z.strictObject({
      title: z.string().min(1),
      milestones: z.array(Milestone).default([]),
    }),
  ),
});

export type Curriculum = z.output<typeof Curriculum>;
