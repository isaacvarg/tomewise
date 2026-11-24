import { z } from "zod";
import { Id } from "./items.ts";
import { PassMark } from "./schemas.ts";

export const milestoneStatuses = ["done", "current", "upcoming", "skipped", "changed"] as const;

export type MilestoneStatus = (typeof milestoneStatuses)[number];

export const milestoneStatus = z.enum(milestoneStatuses, { error: `Use a milestone status: ${milestoneStatuses.join(", ")}` });

const Milestone = z.strictObject({
  id: Id,
  title: z.string().min(1),
  status: milestoneStatus,
  lessons: z.array(z.string().min(1)).default([]),
  reference: z.array(z.string().min(1)).default([]).meta({ description: "Reference sheet ids in reference/ that go with this milestone. In an upcoming milestone they are marked as later." }),
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
