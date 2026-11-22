import { z } from "zod";
import { PayloadSchemas } from "./payload.ts";

export const SUPPORTED_FORMAT_VERSION = 1;

export const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function isTimezone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const Timezone = z.string().refine(isTimezone, {
  error: (issue) => `Unknown timezone ${JSON.stringify(issue.input)}; use an IANA name such as "Europe/London"`,
});

export function formatVersionTooNew(version: number): string {
  return `This learning home uses formatVersion ${version}, but this version of Tomewise supports up to ${SUPPORTED_FORMAT_VERSION}. Upgrade Tomewise to open it.`;
}

const RestDaysPerWeek = z.int().min(0).max(6);

export const StreakRules = z.strictObject({ restDaysPerWeek: RestDaysPerWeek });

export type StreakRules = z.output<typeof StreakRules>;

export const Goal = z.strictObject({
  id: z.string().min(1),
  per: z.enum(["day", "week"]),
  minutes: z.number().positive(),
});

export type Goal = z.output<typeof Goal>;

export const ruleChanges = {
  "goal.changed": z.strictObject({ from: z.array(Goal), to: z.array(Goal) }),
  "streak.changed": z.strictObject({ from: StreakRules, to: StreakRules }),
};

export const DEFAULT_THEME = "paper";

export const ThemeName = z.string().regex(/^[A-Za-z0-9][\w.-]*$/, {
  error: (issue) => `Theme ${JSON.stringify(issue.input)} must be a folder name, such as "paper" or "meadow"`,
});

const ThemePath = z
  .string()
  .regex(/^(?!.*(?:^|\/)\.\.?(?:\/|$))[\w.-]+(?:\/[\w.-]+)*$/, {
    error: (issue) => `${JSON.stringify(issue.input)} must be a path inside the theme folder, such as "theme.js"`,
  });

export const ThemeManifest = z.strictObject({
  name: z.string().min(1),
  author: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  script: ThemePath.optional(),
});

export type ThemeManifest = z.output<typeof ThemeManifest>;

export const explanationText = z.string().trim().min(1, { error: "An explanation needs some text" });

export const TomewiseConfig = z.strictObject({
  formatVersion: z.int().min(1).max(SUPPORTED_FORMAT_VERSION, {
    error: (issue) => formatVersionTooNew(issue.input as number),
  }),
  timezone: Timezone.default(systemTimezone),
  weekStart: z.enum(weekdays).default("monday"),
  minimumSessionSeconds: z.number().min(0).default(60),
  streak: z.strictObject({ restDaysPerWeek: RestDaysPerWeek.default(0) }).default({ restDaysPerWeek: 0 }),
  theme: ThemeName.default(DEFAULT_THEME),
});

export type TomewiseConfig = z.output<typeof TomewiseConfig>;

const homeWide = (name: string) =>
  z.never({ error: `${name} is set for the whole learning home in tomewise.json, not per subject` }).optional();

export const SubjectSettings = z.strictObject({
  minimumSessionSeconds: z.number().min(0).optional(),
  timezone: homeWide("timezone"),
  weekStart: homeWide("weekStart"),
});

export const SubjectFile = z.strictObject({
  name: z.string().min(1),
  settings: SubjectSettings.default({}),
  goals: z.array(Goal).default([]),
  payloadSchemas: PayloadSchemas,
});

export type SubjectFile = z.output<typeof SubjectFile>;
