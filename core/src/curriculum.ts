import { z } from "zod";
import { Id } from "./items.ts";

export const milestoneStatuses = ["done", "current", "upcoming", "skipped", "changed"] as const;

const Milestone = z.strictObject({
  id: Id,
  title: z.string().min(1),
  status: z.enum(milestoneStatuses),
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
