import { z } from "zod";

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

export const TomewiseConfig = z.strictObject({
  formatVersion: z.int().min(1).max(SUPPORTED_FORMAT_VERSION, {
    error: (issue) => formatVersionTooNew(issue.input as number),
  }),
  timezone: Timezone.default(systemTimezone),
  weekStart: z.enum(weekdays).default("monday"),
  minimumSessionSeconds: z.number().min(0).default(60),
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
});

export type SubjectFile = z.output<typeof SubjectFile>;
