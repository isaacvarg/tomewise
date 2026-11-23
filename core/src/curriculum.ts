import { z } from "zod";
import { Id } from "./items.ts";
import { PassMark } from "./schemas.ts";

export const milestoneStatuses = ["done", "current", "upcoming", "skipped", "changed"] as const;

const Milestone = z.strictObject({
  id: Id,
  title: z.string().min(1),
  status: z.enum(milestoneStatuses),
  lessons: z.array(z.string().min(1)).default([]),
  exam: z.string().min(1).optional(),
  passMark: PassMark.optional().meta({ description: "Pass mark for this milestone's exam, as a percentage. Wins over passMark in the assessment settings." }),
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
