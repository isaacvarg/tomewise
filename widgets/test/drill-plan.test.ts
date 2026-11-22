import { describe, expect, it } from "vitest";
import type { Drill, Item } from "@tomewise/core";
import { labelOf, median, planDrill, present, WIDGET_FOR } from "../src/drill-plan.ts";

const letter = (answer: string, tags = ["letter"]): Item => ({
  id: `letter-${answer.toLowerCase()}`,
  type: "timed-audio",
  audio: `assets/audio/${answer.toLowerCase()}.wav`,
  answer,
  tags,
  retired: false,
});

const card = (id: string, tags: string[] = []): Item => ({ id, type: "flashcard", front: id, back: id, tags, retired: false });

const drill = (fields: Partial<Drill> = {}): Drill => ({
  id: "listen",
  builtIn: false,
  name: "Listen",
  select: { from: "unlocked", tags: [] },
  format: "item",
  ...fields,
});

function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("planDrill", () => {
  it("keeps due order and stops at count, without repeats", () => {
    const due = [card("c"), card("a"), card("b")];
    expect(planDrill(drill({ select: { from: "due", tags: [] }, count: 2 }), due).map((item) => item.id)).toEqual(["c", "a"]);
    expect(planDrill(drill({ select: { from: "due", tags: [] }, count: 9 }), due)).toHaveLength(3);
  });

  it("keeps only items with one of the drill's tags", () => {
    const items = [card("a", ["verb"]), card("b", ["noun"]), card("c", ["verb", "noun"]), card("d")];
    const plan = planDrill(drill({ select: { from: "due", tags: ["verb"] } }), items);
    expect(plan.map((item) => item.id)).toEqual(["a", "c"]);
    expect(planDrill(drill({ select: { from: "due", tags: [] } }), items)).toHaveLength(4);
  });

  it("draws unlocked items in shuffled rounds until count, so each comes up evenly", () => {
    const pool = ["K", "M", "R"].map((answer) => letter(answer));
    const plan = planDrill(drill({ count: 7 }), pool, sequence(0.1, 0.9, 0.5, 0.3));
    expect(plan).toHaveLength(7);
    const counts = Object.groupBy(plan, (item) => item.id);
    expect(Object.values(counts).map((items) => items!.length).sort()).toEqual([2, 2, 3]);
    for (const round of [plan.slice(0, 3), plan.slice(3, 6)]) {
      expect(new Set(round.map((item) => item.id)).size).toBe(3);
    }
  });

  it("draws every unlocked item once when the drill has no count", () => {
    const pool = ["K", "M", "R"].map((answer) => letter(answer));
    expect(planDrill(drill(), pool).map((item) => item.id).sort()).toEqual(["letter-k", "letter-m", "letter-r"]);
  });

  it("leaves out retired items and types no widget presents", () => {
    const routine: Item = { id: "warm-up", type: "routine", name: "Warm up", steps: [{ text: "Breathe" }], tags: [], retired: false };
    const retired = { ...card("old"), retired: true };
    expect(planDrill(drill(), [routine, retired, card("a")]).map((item) => item.id)).toEqual(["a"]);
  });

  it("returns nothing for an empty pool", () => {
    expect(planDrill(drill({ count: 5 }), [])).toEqual([]);
  });
});

describe("present", () => {
  it("maps each item type to its widget", () => {
    expect(WIDGET_FOR).toEqual({
      flashcard: "tome-flashcard",
      "multiple-choice": "tome-choice",
      "typed-answer": "tome-typed",
      "timed-audio": "tome-audio",
    });
    expect(present(card("hola"), drill(), [])).toEqual({ tag: "tome-flashcard", attributes: { ref: "item:hola" } });
  });

  it("gives timed-audio items the plan's answers as choices in a multiple-choice drill", () => {
    const plan = ["R", "K", "M", "K"].map((answer) => letter(answer));
    const shown = present(plan[0]!, drill({ format: "multiple-choice" }), plan);
    expect(shown).toEqual({ tag: "tome-audio", attributes: { ref: "item:letter-r", choices: "K M R" } });
  });

  it("lets timed-audio items be typed in their own format", () => {
    const plan = ["R", "K"].map((answer) => letter(answer));
    expect(present(plan[0]!, drill({ format: "item" }), plan).attributes).toEqual({ ref: "item:letter-r" });
    expect(present(plan[0]!, drill({ format: "typed-answer" }), plan).attributes).toEqual({ ref: "item:letter-r" });
  });

  it("passes the per-item time limit and payload on", () => {
    const shown = present(card("hola"), drill({ timeLimits: { perItemSeconds: 5 } }), [], '{"wpm":20}');
    expect(shown.attributes).toEqual({ ref: "item:hola", "time-limit": "5", payload: '{"wpm":20}' });
  });
});

describe("summary helpers", () => {
  it("labels items by what the learner recognises", () => {
    expect(labelOf(letter("K"))).toBe("K");
    expect(labelOf(card("hola"))).toBe("hola");
  });

  it("takes the median", () => {
    expect(median([])).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
