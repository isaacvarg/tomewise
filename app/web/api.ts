import type {
  Activity,
  AgentPrompt,
  AppSetting,
  AssessmentOverrides,
  AssessmentSettings,
  ChartSeries,
  DueItem,
  Explanation,
  QuizFrequency,
  ScheduledItem,
  StartMode,
  Subject,
} from "@tomewise/core";

export type { Activity, AgentPrompt, AssessmentOverrides, AssessmentSettings, ChartSeries, DueItem, Explanation, QuizFrequency, ScheduledItem, StartMode, Subject };

export interface SubjectStats {
  totals: { durationMs: number; sessions: number; accuracy: number | null };
  charts: ChartSeries[];
}

export interface SubjectPrompts {
  prompts: AgentPrompt[];
  explanations: Explanation[];
}

export interface ThemeChoice {
  name: string;
  label: string;
  description?: string;
  stylesheets: string[];
  script?: string;
}

export interface Settings {
  theme: string;
  start: StartMode;
  subjects: string[];
  assessments: AssessmentSettings;
  subjectAssessments: Record<string, AssessmentOverrides>;
  themes: ThemeChoice[];
}

async function getJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { accept: "application/json", ...init.headers } });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(body?.error ?? `${path} answered ${response.status}`);
  return body as T;
}

const subjectPath = (id: string) => `/api/subjects/${encodeURIComponent(id)}`;

export const api = {
  subjects: () => getJson<{ subjects: Subject[] }>("/api/subjects").then((body) => body.subjects),
  subject: (id: string) => getJson<Subject>(subjectPath(id)),
  due: (id: string, date: string) =>
    getJson<{ due: DueItem[] }>(`${subjectPath(id)}/due?date=${encodeURIComponent(date)}`).then((body) => body.due),
  unlocked: (id: string) => getJson<{ today: string; items: ScheduledItem[] }>(`${subjectPath(id)}/unlocked`),
  activity: (subject?: string) =>
    getJson<Activity>(subject === undefined ? "/api/activity" : `/api/activity?subject=${encodeURIComponent(subject)}`),
  completedLessons: (id: string) =>
    getJson<{ completedLessons: string[] }>(`${subjectPath(id)}/progress`).then((body) => body.completedLessons),
  stats: (id: string) => getJson<SubjectStats>(`${subjectPath(id)}/stats`),
  prompts: (id: string) => getJson<SubjectPrompts>(`${subjectPath(id)}/prompts`),
  allPrompts: () =>
    getJson<{ subjects: { subject: string; prompts: AgentPrompt[] }[] }>("/api/prompts").then((body) => body.subjects),
  settings: () => getJson<Settings>("/api/settings"),
  saveSetting: (key: AppSetting, value: unknown) =>
    getJson<Settings>(`/api/settings/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    }),
  saveSubjectAssessments: (id: string, value: AssessmentOverrides) =>
    getJson<Settings>(`/api/settings/subjects/${encodeURIComponent(id)}/assessments`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    }),
};
