import type { Activity, AgentPrompt, AppSetting, ChartSeries, DueItem, Explanation, MilestoneStatus, ScheduledItem, StartMode, Subject } from "@tomewise/core";

export type { Activity, AgentPrompt, ChartSeries, DueItem, Explanation, MilestoneStatus, ScheduledItem, StartMode, Subject };

export interface Progress {
  completedLessons: string[];
  milestones: Record<string, MilestoneStatus>;
}

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

export interface SyncStatus {
  enabled: boolean;
  stopped: boolean;
  lastPull: string | null;
  lastCommit: string | null;
  lastPush: string | null;
  lastError: { at: string; message: string } | null;
}

export interface Settings {
  theme: string;
  start: StartMode;
  subjects: string[];
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
  progress: (id: string) => getJson<Progress>(`${subjectPath(id)}/progress`),
  stats: (id: string) => getJson<SubjectStats>(`${subjectPath(id)}/stats`),
  prompts: (id: string) => getJson<SubjectPrompts>(`${subjectPath(id)}/prompts`),
  allPrompts: () =>
    getJson<{ subjects: { subject: string; prompts: AgentPrompt[] }[] }>("/api/prompts").then((body) => body.subjects),
  sync: () => getJson<SyncStatus>("/api/sync"),
  syncNow: () => getJson<SyncStatus>("/api/sync", { method: "POST" }),
  settings: () => getJson<Settings>("/api/settings"),
  saveSetting: (key: AppSetting, value: unknown) =>
    getJson<Settings>(`/api/settings/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    }),
};
