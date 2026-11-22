import type { Activity, DueItem, Subject } from "@tomewise/core";

export type { Activity, DueItem, Subject };

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
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
  activity: () => getJson<Activity>("/api/activity"),
};
