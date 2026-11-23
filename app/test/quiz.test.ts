import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

type Dashboard = Awaited<ReturnType<typeof startDashboard>>;
type Event = { id: string; kind: string; ref?: string; sessionId?: string; outcome?: string; grade?: number };

const SPANISH = "subjects/spanish";
const QUIZ_REF = "drill:quiz-2026-11-21";

function withSpanish(assessments: Record<string, unknown> = {}) {
  return async (root: string) => {
    await writeFile(join(root, SPANISH, "subject.json"), JSON.stringify({ name: "Spanish", settings: { assessments } }));
    const file = join(root, SPANISH, "items/vocab.json");
    const items = JSON.parse(await readFile(file, "utf8")) as unknown[];
    items.push({ id: "rojo", type: "multiple-choice", prompt: "Which word means red?", choices: ["azul", "rojo"], answer: "rojo" });
    await writeFile(file, JSON.stringify(items));
  };
}

async function eventsAfter(dashboard: Dashboard, before: Set<string>, done: (events: Event[]) => boolean) {
  let latest: Event[] = [];
  await expect
    .poll(
      async () => {
        const { body } = await dashboard.app.get("/api/subjects/spanish/events");
        latest = (body.events as Event[]).filter((event) => !before.has(event.id));
        return done(latest);
      },
      { timeout: 5000, interval: 50 },
    )
    .toBe(true);
  return latest;
}

async function eventIds(dashboard: Dashboard) {
  const { body } = await dashboard.app.get("/api/subjects/spanish/events");
  return new Set((body.events as Event[]).map((event) => event.id));
}

const ended = (events: Event[]) => events.some((event) => event.kind === "session.end");
const texts = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));

async function startQuiz(width: Width, assessments?: Record<string, unknown>) {
  const dashboard = await startDashboard({ width, prepare: withSpanish(assessments) });
  const page = await dashboard.open("/s/spanish");
  await page.locator(".tome-quiz-me").click();
  await page.waitForURL(/\/run\/quiz\?subject=spanish$/);
  const runner = page.locator(".tome-runner");
  await expect.poll(() => runner.locator(".tome-drill-name").textContent()).toBe("Quiz");
  return { ...dashboard, page, runner, before: await eventIds(dashboard) };
}

async function answerAll(page: Page, grades: (1 | 3)[], choice: string, start = 0) {
  const runner = page.locator(".tome-runner");
  const total = start + grades.length + 1;
  const at = (n: number) => expect.poll(() => runner.locator(".tome-count").textContent()).toBe(`${n} / ${total}`);
  for (const [index, grade] of grades.entries()) {
    await at(start + index + 1);
    await runner.locator(".tome-reveal").click();
    await runner.locator(`.tome-grade[data-grade="${grade}"]`).click();
  }
  await at(total);
  await runner.locator(`.tome-answer:has-text("${choice}")`).click();
}

describe.each(["phone", "desktop"] as const)("an app-built quiz at %s width", (width) => {
  it("runs from Quiz me with no per-answer feedback, then lists each answer and the score", async () => {
    const dashboard = await startQuiz(width);
    const { page, runner, before, pageErrors } = dashboard;
    expect(await runner.locator('.tome-drill[data-mode="quiz"]').count()).toBe(1);

    const runnerHidesFeedback = async () => {
      const verdicts = await runner.locator(".tome-verdict, .tome-feedback").evaluateAll((els) => els.map((el) => getComputedStyle(el).visibility));
      return verdicts.every((visibility) => visibility === "hidden");
    };
    await runner.locator(".tome-reveal").click();
    await runner.locator('.tome-grade[data-grade="1"]').click();
    expect(await runnerHidesFeedback()).toBe(true);
    expect(await runner.locator(".tome-next").count()).toBe(0);
    await answerAll(page, [3, 3, 1], "azul", 1);

    await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
    const summary = runner.locator(".tome-runner-summary");
    expect(await summary.locator(".tome-kicker").innerText()).toBe("Quiz done");
    expect(await summary.locator(".tome-score").innerText()).toBe("40%");
    expect(await summary.locator(".tome-score-sub").innerText()).toBe("2 of 5 right");
    expect(await texts(page, ".tome-quiz-answers li")).toEqual([
      "hola\nWrong\nYou: Again\nAnswer: hello",
      "adiós\nRight\nYou: Good\nAnswer: goodbye",
      "el gato\nRight\nYou: Good\nAnswer: the cat",
      "el perro\nWrong\nYou: Again\nAnswer: the dog",
      "Which word means red?\nWrong\nYou: azul\nAnswer: rojo",
    ]);

    const events = await eventsAfter(dashboard, before, ended);
    expect(events.map((event) => event.kind)).toEqual(["session.start", ...Array(5).fill("attempt"), "session.end"]);
    expect(events[0]!.ref).toBe(QUIZ_REF);
    expect(events.at(-1)!.ref).toBe(QUIZ_REF);
    expect(events.slice(1, -1).map((event) => [event.ref, event.grade])).toEqual([
      ["item:hola", 1],
      ["item:adios", 3],
      ["item:gato", 3],
      ["item:perro", 1],
      ["item:rojo", 1],
    ]);

    const { body } = await dashboard.app.get("/api/subjects/spanish/due?date=2026-11-21");
    expect((body.due as { item: { id: string } }[]).map(({ item }) => item.id)).toEqual(expect.arrayContaining(["hola", "perro", "rojo"]));

    const used = await page
      .locator(".tome-runner, .tome-runner *:not(tome-drill, tome-drill *)")
      .evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))))]);
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 30_000);

  it("shows pass or fail against the pass mark", async () => {
    const { page, runner } = await startQuiz(width, { scoreDisplay: "pass-fail", passMark: 40 });
    await answerAll(page, [1, 3, 3, 1], "azul");

    await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
    expect(await runner.locator(".tome-score").innerText()).toBe("Passed");
    expect(await runner.locator(".tome-score-sub").innerText()).toBe("Pass mark 40%");
  }, 30_000);

  it("hides a hidden score but still records every answer", async () => {
    const dashboard = await startQuiz(width, { scoreDisplay: "hidden" });
    const { page, runner, before } = dashboard;
    await answerAll(page, [1, 3, 3, 1], "rojo");

    await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
    expect(await runner.locator(".tome-score").count()).toBe(0);
    expect(await runner.locator(".tome-quiz-mark").count()).toBe(0);
    expect(await runner.locator(".tome-score-sub").innerText()).toBe("Your score is saved for your agent, not shown.");
    expect(await texts(page, ".tome-quiz-answers li")).toHaveLength(5);
    const events = await eventsAfter(dashboard, before, ended);
    expect(events.filter((event) => event.kind === "attempt").map((event) => event.outcome)).toEqual(["wrong", "correct", "correct", "wrong", "correct"]);
    expect(events[0]!.ref).toBe(QUIZ_REF);
  }, 30_000);

  it("ends a timed quiz at the limit", async () => {
    const dashboard = await startQuiz(width, { timed: { minutes: 0.05 } });
    const { runner, before } = dashboard;
    expect(await runner.locator(".tome-clock").innerText()).toBe("0:03");
    await runner.locator(".tome-reveal").click();
    await runner.locator('.tome-grade[data-grade="3"]').click();

    await expect.poll(() => runner.getAttribute("data-state"), { timeout: 6000 }).toBe("done");
    expect(await runner.locator(".tome-runner-summary .tome-kicker").innerText()).toBe("Time's up");
    expect(await runner.locator(".tome-runner-summary .tome-score-sub").innerText()).toBe("1 of 5 right");
    const events = await eventsAfter(dashboard, before, ended);
    expect(events.map((event) => event.kind)).toEqual(["session.start", "attempt", "session.end"]);
  }, 30_000);
});

describe("Quiz me", () => {
  it("is absent when assessments are off, and the quiz address explains why", async () => {
    const dashboard = await startDashboard({ prepare: withSpanish({ enabled: false }) });
    const page = await dashboard.open("/s/spanish");
    await page.locator(".tome-due").waitFor();
    expect(await page.locator(".tome-quiz-me").count()).toBe(0);

    await dashboard.open("/run/quiz?subject=spanish");
    const runner = page.locator(".tome-runner");
    await expect.poll(() => runner.getAttribute("data-state")).toBe("error");
    expect(await page.locator(".tome-notice").innerText()).toBe("Assessments are off for Spanish, so it has no quizzes.");
  });
});
