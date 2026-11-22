import { isDeepStrictEqual } from "node:util";
import { appendEvents, type Goal, type LearningEvent, readEvents, type StreakRules, type Subject } from "@tomewise/core";
import type { Exclusive } from "./sync.ts";
import type { HomeView, WatchedHome } from "./watcher.ts";

type RuleKind = "goal.changed" | "streak.changed";

function later(a: LearningEvent | undefined, b: LearningEvent | undefined): LearningEvent | undefined {
  if (!a || !b) return a ?? b;
  const [ta, tb] = [Date.parse(a.ts), Date.parse(b.ts)];
  return ta > tb || (ta === tb && a.id > b.id) ? a : b;
}

function recordedRules(event: LearningEvent | undefined): unknown {
  return (event?.data as { to?: unknown } | undefined)?.to;
}

function change(subject: Subject, kind: RuleKind, from: unknown, to: unknown) {
  const schemaVersion = Math.max(...subject.payloadSchemas.map((version) => version.version));
  return { subject: subject.id, kind, schemaVersion, data: { from, to } };
}

export async function trackRuleChanges(
  watched: WatchedHome,
  exclusive: Exclusive,
  onError: (error: unknown) => void,
): Promise<void> {
  const startup = watched.current();
  const goalBaseline = new Map<string, Goal[]>();
  const streakBaseline: StreakRules = startup.home.config.streak;
  for (const [id, subject] of startup.subjects) goalBaseline.set(id, subject.goals);

  async function record(view: HomeView) {
    const changes: ReturnType<typeof change>[] = [];
    let lastStreak: LearningEvent | undefined;
    for (const [id, subject] of view.subjects) {
      if (!goalBaseline.has(id)) goalBaseline.set(id, subject.goals);
      const events = await readEvents(view.home, id);
      const goalsFrom = recordedRules(events.findLast((event) => event.kind === "goal.changed")) ?? goalBaseline.get(id);
      if (!isDeepStrictEqual(goalsFrom, subject.goals)) changes.push(change(subject, "goal.changed", goalsFrom, subject.goals));
      lastStreak = later(lastStreak, events.findLast((event) => event.kind === "streak.changed"));
    }
    const first = [...view.subjects.values()].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    const streakFrom = recordedRules(lastStreak) ?? streakBaseline;
    if (first && !isDeepStrictEqual(streakFrom, view.home.config.streak)) {
      changes.push(change(first, "streak.changed", streakFrom, view.home.config.streak));
    }
    if (changes.length > 0) await exclusive(() => appendEvents(view.home, changes, { target: "main" }));
  }

  let pending = Promise.resolve();
  const run = (view: HomeView) => (pending = pending.catch(() => undefined).then(() => record(view)));
  watched.onReload(run);
  await run(startup).catch(onError);
}
