import { z } from "zod";
import { itemTypes } from "./items.ts";

export const drillFormats = ["item", ...itemTypes.filter((type) => type !== "routine")] as const;

export const DrillFile = z.strictObject({
  name: z.string().min(1),
  select: z.strictObject({
    from: z.enum(["due", "unlocked"]),
    tags: z.array(z.string().min(1)).default([]),
  }),
  count: z.int().positive().optional(),
  format: z.enum(drillFormats).default("item"),
  timeLimits: z
    .strictObject({
      perItemSeconds: z.number().positive().optional(),
      totalSeconds: z.number().positive().optional(),
    })
    .optional(),
});

export type DrillFile = z.output<typeof DrillFile>;

export type Drill = DrillFile & { id: string; builtIn: boolean };

export const REVIEW_DRILL_ID = "review";

export const reviewDrill: Drill = {
  id: REVIEW_DRILL_ID,
  builtIn: true,
  name: "Review everything due",
  select: { from: "due", tags: [] },
  format: "item",
};
