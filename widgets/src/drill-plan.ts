import type { Drill, Item } from "@tomewise/core";

export const WIDGET_FOR: Partial<Record<Item["type"], string>> = {
  flashcard: "tome-flashcard",
  "multiple-choice": "tome-choice",
  "typed-answer": "tome-typed",
  "timed-audio": "tome-audio",
};

export interface Presentation {
  tag: string;
  attributes: Record<string, string>;
}

export function matchesTags(item: Item, tags: readonly string[]): boolean {
  return tags.length === 0 || tags.some((tag) => item.tags.includes(tag));
}

export function shuffled<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function planDrill(drill: Drill, candidates: readonly Item[], random: () => number = Math.random): Item[] {
  const pool = candidates.filter(
    (item) => !item.retired && WIDGET_FOR[item.type] !== undefined && matchesTags(item, drill.select.tags),
  );
  const count = drill.count ?? pool.length;
  if (drill.select.from === "due") return pool.slice(0, count);
  const plan: Item[] = [];
  while (pool.length > 0 && plan.length < count) plan.push(...shuffled(pool, random));
  return plan.slice(0, count);
}

function choicesFor(plan: readonly Item[]): string | undefined {
  const answers = [
    ...new Set(plan.flatMap((item) => (item.type === "timed-audio" ? [item.answer] : []))),
  ].sort((a, b) => a.localeCompare(b));
  return answers.length > 1 && answers.every((answer) => !/\s/.test(answer)) ? answers.join(" ") : undefined;
}

export function present(item: Item, drill: Drill, plan: readonly Item[], payload?: string): Presentation {
  const tag = WIDGET_FOR[item.type];
  if (!tag) throw new Error(`No widget presents ${item.type} items.`);
  const attributes: Record<string, string> = { ref: `item:${item.id}` };
  if (item.type === "timed-audio" && drill.format === "multiple-choice") {
    const choices = choicesFor(plan);
    if (choices) attributes.choices = choices;
  }
  const seconds = drill.timeLimits?.perItemSeconds;
  if (seconds !== undefined) attributes["time-limit"] = String(seconds);
  if (payload) attributes.payload = payload;
  return { tag, attributes };
}

export function labelOf(item: Item): string {
  switch (item.type) {
    case "flashcard":
      return item.front;
    case "routine":
      return item.name;
    default:
      return item.answer;
  }
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
