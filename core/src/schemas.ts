import { z } from "zod";
import { Chart } from "./charts.ts";
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

const feedbackError = { error: "A grade needs the agent's feedback" };

export const gradeFeedback = z.string(feedbackError).trim().min(1, feedbackError);

export const GIT_CADENCES = ["session", "hourly", "daily"] as const;

export type GitCadence = (typeof GIT_CADENCES)[number];

export const DEFAULT_GIT_CADENCE: GitCadence = "session";

const GitRemote = z.string().regex(/^[A-Za-z0-9][\w.-]*$/, {
  error: (issue) => `Remote ${JSON.stringify(issue.input)} must be a git remote name, such as "origin"`,
});

const GitBranch = z.string().regex(/^(?!.*\.\.)(?!.*\/\.)(?!.*\.lock(?:\/|$))\w[\w.-]*(?:\/[\w.-]+)*(?<!\.)$/, {
  error: (issue) => `${JSON.stringify(issue.input)} must be a git branch name, such as "main"`,
});

export const GitSettings = z
  .strictObject({
    enabled: z.boolean().default(true).meta({ description: "Whether the app syncs the learning home with git." }),
    cadence: z
      .enum(GIT_CADENCES, { error: `Use one of ${GIT_CADENCES.map((cadence) => `"${cadence}"`).join(", ")}` })
      .default(DEFAULT_GIT_CADENCE)
      .meta({ description: "When the app commits events: after each session, at the top of each hour, or at midnight in the learning home's timezone." }),
    remote: GitRemote.optional().meta({
      description:
        "Name of the git remote to pull from and push to, such as \"origin\". The remote itself is set up in each clone with git remote add. Without one the app only commits.",
    }),
    branch: GitBranch.optional().meta({ description: "Branch to pull and push. Defaults to the checked-out branch." }),
    push: z.boolean().default(false).meta({ description: "Whether the app pushes its history commits, after each commit and after each pull. Needs a remote." }),
    pullIntervalMinutes: z
      .int()
      .min(1)
      .max(1440)
      .default(5)
      .meta({ description: "Minutes between pulls from the remote." }),
  })
  .refine((git) => !git.push || git.remote !== undefined, {
    path: ["push"],
    error: 'Push needs a remote; set git.remote, such as "origin", or set push to false',
  })
  .meta({
    description: "Git sync settings. Leave the block out to keep git sync off; a block turns it on unless enabled is false.",
    if: { properties: { push: { const: true } }, required: ["push"] },
    then: { required: ["remote"] },
  });

export type GitSettings = z.output<typeof GitSettings>;

export const START_MODES = ["sequence", "ask"] as const;

export type StartMode = (typeof START_MODES)[number];

export const StartMode = z.enum(START_MODES, { error: `Use ${START_MODES.map((mode) => `"${mode}"`).join(" or ")}` });

const SubjectId = z.string().regex(/^[A-Za-z0-9][\w.-]*$/, {
  error: (issue) => `${JSON.stringify(issue.input)} must be a subject folder name, such as "morse-code"`,
});

export const SubjectOrder = z.array(SubjectId);

export const QUIZ_FREQUENCIES = ["weekly", "onDemand"] as const;

export const SCORE_DISPLAYS = ["number", "pass-fail", "hidden"] as const;

export type ScoreDisplay = (typeof SCORE_DISPLAYS)[number];

export const PassMark = z
  .number()
  .min(0)
  .max(100)
  .meta({ description: "Lowest score, as a percentage, that passes. Passing means score ≥ pass mark." });

const QuizFrequency = z
  .union([z.strictObject({ every: z.int().min(1).meta({ description: "Completed lessons between quizzes." }) }), z.enum(QUIZ_FREQUENCIES)], {
    error: 'Use { "every": N } lessons, "weekly" or "onDemand"',
  })
  .meta({ description: 'When a quiz is due: every N completed lessons ({ "every": N }), weekly from weekStart, or only when asked ("onDemand").' });

export type QuizFrequency = z.output<typeof QuizFrequency>;

const Timed = z
  .union([z.literal(false), z.strictObject({ minutes: z.number().positive().meta({ description: "Time limit in minutes." }) })], {
    error: 'Use false or { "minutes": N }',
  })
  .meta({ description: 'Whether quizzes and exams have a time limit: false, or { "minutes": N }.' });

export type Timed = z.output<typeof Timed>;

const assessmentFields = {
  enabled: z.boolean().meta({ description: "Whether the subject has quizzes and exams at all." }),
  quizFrequency: QuizFrequency,
  quizLength: z.int().min(1).meta({ description: "Questions in an app-built quiz." }),
  exams: z.boolean().meta({ description: "Whether milestones have exams. With exams off, milestones are marked done by hand." }),
  timed: Timed,
  scoreDisplay: z
    .enum(SCORE_DISPLAYS, { error: `Use ${SCORE_DISPLAYS.map((display) => `"${display}"`).join(", ")}` })
    .meta({ description: "How a score is shown: the number, pass or fail only, or not at all." }),
  passMark: PassMark,
};

export const DEFAULT_ASSESSMENTS = {
  enabled: true,
  quizFrequency: { every: 5 },
  quizLength: 10,
  exams: true,
  timed: false,
  scoreDisplay: "number",
  passMark: 70,
} as const satisfies { [K in keyof typeof assessmentFields]: z.input<(typeof assessmentFields)[K]> };

export const AssessmentSettings = z
  .strictObject({
    enabled: assessmentFields.enabled.default(DEFAULT_ASSESSMENTS.enabled),
    quizFrequency: assessmentFields.quizFrequency.default(DEFAULT_ASSESSMENTS.quizFrequency),
    quizLength: assessmentFields.quizLength.default(DEFAULT_ASSESSMENTS.quizLength),
    exams: assessmentFields.exams.default(DEFAULT_ASSESSMENTS.exams),
    timed: assessmentFields.timed.default(DEFAULT_ASSESSMENTS.timed),
    scoreDisplay: assessmentFields.scoreDisplay.default(DEFAULT_ASSESSMENTS.scoreDisplay),
    passMark: assessmentFields.passMark.default(DEFAULT_ASSESSMENTS.passMark),
  })
  .meta({ description: "Quiz and exam settings for every subject. A subject can override any of them in subject.json." });

export type AssessmentSettings = z.output<typeof AssessmentSettings>;

export const AssessmentOverrides = z
  .strictObject({
    enabled: assessmentFields.enabled.optional(),
    quizFrequency: assessmentFields.quizFrequency.optional(),
    quizLength: assessmentFields.quizLength.optional(),
    exams: assessmentFields.exams.optional(),
    timed: assessmentFields.timed.optional(),
    scoreDisplay: assessmentFields.scoreDisplay.optional(),
    passMark: assessmentFields.passMark.optional(),
  })
  .meta({ description: "This subject's quiz and exam settings. Each one left out comes from assessments in tomewise.json." });

export type AssessmentOverrides = z.output<typeof AssessmentOverrides>;

export const TomewiseConfig = z.strictObject({
  formatVersion: z.int().min(1).max(SUPPORTED_FORMAT_VERSION, {
    error: (issue) => formatVersionTooNew(issue.input as number),
  }),
  timezone: Timezone.default(systemTimezone),
  weekStart: z.enum(weekdays).default("monday"),
  minimumSessionSeconds: z.number().min(0).default(60),
  streak: z.strictObject({ restDaysPerWeek: RestDaysPerWeek.default(0) }).default({ restDaysPerWeek: 0 }),
  theme: ThemeName.default(DEFAULT_THEME),
  start: StartMode.default("sequence").meta({
    description: "What Start does: run what's due in sequence, or ask which subject to practise.",
  }),
  subjects: SubjectOrder.default([]).meta({
    description: "Subject ids in the order the home shows them. Unlisted subjects follow alphabetically.",
  }),
  git: GitSettings.prefault({ enabled: false }),
  assessments: AssessmentSettings.prefault({}),
});

export type TomewiseConfig = z.output<typeof TomewiseConfig>;

const homeWide = (name: string) =>
  z.never({ error: `${name} is set for the whole learning home in tomewise.json, not per subject` }).optional();

export const SubjectSettings = z.strictObject({
  minimumSessionSeconds: z.number().min(0).optional(),
  assessments: AssessmentOverrides.optional(),
  timezone: homeWide("timezone"),
  weekStart: homeWide("weekStart"),
});

export const SubjectFile = z.strictObject({
  name: z.string().min(1),
  settings: SubjectSettings.default({}),
  goals: z.array(Goal).default([]),
  payloadSchemas: PayloadSchemas,
  drillPayload: z.record(z.string(), z.unknown()).optional(),
  charts: z.array(Chart).default([]),
});

export type SubjectFile = z.output<typeof SubjectFile>;
