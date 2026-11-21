import { z } from "zod";

export const itemTypes = ["flashcard", "multiple-choice", "typed-answer", "timed-audio", "routine"] as const;

export const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
  error: "Use lowercase letters, digits and single hyphens, such as \"letter-k\"",
});

const common = {
  id: Id,
  unlockedBy: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
  retired: z.boolean().default(false),
};

const Flashcard = z.strictObject({
  ...common,
  type: z.literal("flashcard"),
  front: z.string().min(1),
  back: z.string().min(1),
});

const MultipleChoice = z
  .strictObject({
    ...common,
    type: z.literal("multiple-choice"),
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).min(2),
    answer: z.string().min(1),
  })
  .refine((item) => item.choices.includes(item.answer), {
    path: ["answer"],
    error: "The answer must be one of the choices",
  });

const TypedAnswer = z.strictObject({
  ...common,
  type: z.literal("typed-answer"),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  accept: z.array(z.string().min(1)).default([]),
});

const TimedAudio = z
  .strictObject({
    ...common,
    type: z.literal("timed-audio"),
    prompt: z.string().min(1).optional(),
    audio: z.string().min(1).optional(),
    answer: z.string().min(1),
    timeLimitSeconds: z.number().positive().optional(),
  })
  .refine((item) => item.prompt !== undefined || item.audio !== undefined, {
    path: ["audio"],
    error: "A timed-audio item needs an audio file, a prompt, or both",
  });

const Routine = z.strictObject({
  ...common,
  type: z.literal("routine"),
  name: z.string().min(1),
  steps: z
    .array(z.strictObject({ text: z.string().min(1), seconds: z.number().positive().optional() }))
    .min(1),
});

export const Item = z.discriminatedUnion("type", [Flashcard, MultipleChoice, TypedAnswer, TimedAudio, Routine], {
  error: (issue) =>
    issue.code === "invalid_union" ? `Unknown item type; use one of ${itemTypes.join(", ")}` : undefined,
});

export type Item = z.output<typeof Item>;
