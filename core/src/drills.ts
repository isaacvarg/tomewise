import { z } from "zod";
import { itemTypes } from "./items.ts";
import type { AssessmentSettings } from "./schemas.ts";

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

export type Drill = DrillFile & { id: string; builtIn: boolean; quiz?: boolean };

export const REVIEW_DRILL_ID = "review";

export const reviewDrill: Drill = {
  id: REVIEW_DRILL_ID,
  builtIn: true,
  name: "Review everything due",
  select: { from: "due", tags: [] },
  format: "item",
};

const QUIZ_DRILL_ID = /^quiz-\d{4}-\d{2}-\d{2}$/;

export function isQuizDrillId(id: string): boolean {
  return QUIZ_DRILL_ID.test(id);
}

export function quizDrill(date: string, count: number, { timed }: Pick<AssessmentSettings, "timed">): Drill {
  const id = `quiz-${date}`;
  if (!isQuizDrillId(id)) throw new RangeError(`Not a date: ${date}; use YYYY-MM-DD`);
  return {
    id,
    builtIn: true,
    quiz: true,
    name: "Quiz",
    select: { from: "unlocked", tags: [] },
    count,
    format: "item",
    ...(timed && { timeLimits: { totalSeconds: timed.minutes * 60 } }),
  };
}
