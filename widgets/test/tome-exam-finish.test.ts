import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locator } from "playwright";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

const SUBJECT = "spanish";
const EXAM = "/s/spanish/exams/check.html";

const kinds = (events: LearningEvent[]) => events.map((event) => event.kind);

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Check</title></head><body>
<h1>Check</h1>
<tome-exam-question id="colour" tests="item:rojo">
  <p>A ripe tomato is…</p>
  <tome-choice answer="rojo"><option>azul</option><option>rojo</option></tome-choice>
</tome-exam-question>
<tome-exam-question id="thanks" tests="item:gracias">
  <p>Thank someone warmly.</p>
  <tome-choice answer="muchas gracias"><option>muchas gracias</option><option>hola</option></tome-choice>
</tome-exam-question>
<tome-done></tome-done>
</body></html>`;

async function openExam({ scoreDisplay, passMark = 50 }: { scoreDisplay?: string; passMark?: number } = {}) {
  const widgets = await startWidgetApp({
    prepare: async (root) => {
      const dir = join(root, "subjects/spanish");
      await mkdir(join(dir, "exams"), { recursive: true });
      await writeFile(join(dir, "exams/check.html"), PAGE);
      await writeFile(join(dir, "subject.json"), JSON.stringify({ name: "Spanish", ...(scoreDisplay && { settings: { assessments: { scoreDisplay } } }) }));
      await writeFile(
        join(dir, "curriculum.json"),
        JSON.stringify({ units: [{ title: "Basics", milestones: [{ id: "basics", title: "Basics", status: "current", exam: "check", passMark }] }] }),
      );
    },
  });
  const page = await widgets.open(EXAM);
  const done = page.locator("tome-done");
  const button = done.getByRole("button", { name: "Finish exam" });
  await expect.poll(() => button.count()).toBe(1);
  for (const id of ["colour", "thanks"]) {
    await expect.poll(() => page.locator(`#${id} .tome-exam-question`).getAttribute("data-state")).toBe("ready");
  }
  const answer = async (id: string, choice: string) => {
    await page.locator(`#${id}`).getByRole("button", { name: new RegExp(choice) }).click();
    await expect.poll(() => page.locator(`#${id} .tome-exam-question`).getAttribute("data-state")).toBe("answered");
  };
  return { ...widgets, page, done, button, answer };
}

const score = (done: Locator) =>
  done.locator(".tome-exam-score").evaluate((element) => ({
    display: element.getAttribute("data-display"),
    passed: element.getAttribute("data-passed"),
    text: (element as HTMLElement).innerText.split("\n").filter(Boolean),
  }));

describe("<tome-done> on an exam page", () => {
  it("finishes the exam: records the score, marks the milestone done on a pass and shows the number", async () => {
    const { done, button, answer, eventsUntil } = await openExam();
    await answer("colour", "rojo");
    await answer("thanks", "hola");

    await button.click();

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("milestone.status"));
    expect(kinds(events)).toEqual(["session.start", "attempt", "attempt", "session.end", "milestone.status"]);
    const [start, , , end, marked] = events;
    expect(end).toMatchObject({ ref: "exam:check", sessionId: start!.id, score: 50 });
    expect(marked).toMatchObject({ ref: "milestone:basics", sessionId: start!.id, data: { status: "done" } });
    await expect.poll(() => done.locator(".tome-exam-score").count()).toBe(1);
    expect(await score(done)).toEqual({ display: "number", passed: "true", text: ["Exam finished", "50%", "1 of 2 right · pass mark 50%"] });
    expect(await button.isDisabled()).toBe(true);
  });

  it("shows only pass or fail, and appends no milestone event on a fail", async () => {
    const { page, done, button, answer, eventsUntil, events } = await openExam({ scoreDisplay: "pass-fail", passMark: 75 });
    await answer("colour", "rojo");
    await answer("thanks", "hola");

    await button.click();

    await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    await expect.poll(() => done.locator(".tome-exam-score").count()).toBe(1);
    expect(await score(done)).toEqual({
      display: "pass-fail",
      passed: "false",
      text: ["Exam finished", "Not passed", "What you missed comes up for review sooner."],
    });
    expect(await done.innerText()).not.toContain("%");
    await page.goto("about:blank");
    await page.waitForTimeout(300);
    const all = await events(SUBJECT);
    expect(kinds(all)).toEqual(["session.start", "attempt", "attempt", "session.end"]);
    expect(all.at(-1)).toMatchObject({ score: 50 });
  });

  it("hides the score but still records it", async () => {
    const { done, button, answer, eventsUntil } = await openExam({ scoreDisplay: "hidden" });
    await answer("colour", "rojo");
    await answer("thanks", "muchas gracias");

    await button.click();

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("milestone.status"));
    expect(events.find((event) => event.kind === "session.end")).toMatchObject({ score: 100 });
    await expect.poll(() => done.locator(".tome-exam-score").count()).toBe(1);
    expect(await score(done)).toEqual({ display: "hidden", passed: null, text: ["Exam finished", "Your score is saved for your agent."] });
    expect(await done.locator(".tome-score").count()).toBe(0);
  });

  it("counts unanswered questions as missed and locks the questions once finished", async () => {
    const { page, button, answer, eventsUntil } = await openExam({ passMark: 60 });
    await answer("colour", "rojo");

    await button.click();

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(events.at(-1)).toMatchObject({ score: 50 });
    expect(await page.locator("#thanks").getAttribute("inert")).toBe("");
  });

  it("scores an exam the learner leaves without finishing", async () => {
    const { page, answer, eventsUntil } = await openExam();
    await answer("colour", "rojo");

    await page.goto("about:blank");

    const events = await eventsUntil(SUBJECT, (events) => kinds(events).includes("session.end"));
    expect(kinds(events)).toEqual(["session.start", "attempt", "session.end", "milestone.status"]);
    expect(events[2]).toMatchObject({ score: 50 });
  });
});
