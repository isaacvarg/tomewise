import { type Activity, api, type Settings, type Subject } from "./api.ts";
import { type DueToday, dueToday, inSavedOrder } from "./home/model.ts";

export interface Today {
  subjects: Subject[];
  activity: Activity;
  settings: Settings;
  due: DueToday;
}

export async function loadToday(): Promise<Today> {
  const [all, activity, settings] = await Promise.all([api.subjects(), api.activity(), api.settings()]);
  const subjects = inSavedOrder(all, settings.subjects);
  const due = await Promise.all(subjects.map(async (subject) => ({ subject, due: await api.due(subject.id, activity.today) })));
  return { subjects, activity, settings, due: dueToday(due) };
}
