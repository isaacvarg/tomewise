import type { Activity, AppSetting, DueItem, ScheduledItem, StartMode, Subject } from "@tomewise/core";

export type { Activity, DueItem, ScheduledItem, StartMode, Subject };

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
  settings: () => getJson<Settings>("/api/settings"),
  saveSetting: (key: AppSetting, value: unknown) =>
    getJson<Settings>(`/api/settings/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    }),
};
