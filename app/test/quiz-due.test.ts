import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

const MORSE = "subjects/morse-code/subject.json";

async function weeklyQuizzes(root: string) {
  await rm(join(root, "subjects/morse-code/quizzes"), { recursive: true, force: true });
  const file = join(root, MORSE);
  const subject = JSON.parse(await readFile(file, "utf8"));
  const latest = subject.payloadSchemas.at(-1);
  const attempt = { ...latest.kinds.attempt, required: (latest.kinds.attempt.required ?? []).filter((name: string) => name !== "wpm") };
  subject.payloadSchemas.push({ version: latest.version + 1, kinds: { attempt } });
  await writeFile(file, JSON.stringify({ ...subject, settings: { assessments: { quizFrequency: "weekly", quizLength: 3 } } }));
}

const WRITTEN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="tome-after" content="lesson:0002-r"><title>After R</title></head><body>
<h1>After R</h1>
<tome-exam-question id="k" tests="item:letter-k"><p>Which is dah-di-dah?</p><tome-choice answer="K"><option>K</option><option>R</option></tome-choice></tome-exam-question>
<tome-exam-question id="r" tests="item:letter-r"><p>Which is di-dah-dit?</p><tome-choice answer="R"><option>K</option><option>R</option></tome-choice></tome-exam-question>
<tome-done></tome-done>
</body></html>`;

async function writtenWeekly(root: string) {
  await weeklyQuizzes(root);
  const file = join(root, MORSE);
  const subject = JSON.parse(await readFile(file, "utf8"));
  subject.payloadSchemas.at(-1).kinds.attempt.required = [];
  await writeFile(file, JSON.stringify(subject));
  await mkdir(join(root, "subjects/morse-code/quizzes"), { recursive: true });
  await writeFile(join(root, "subjects/morse-code/quizzes/after-r.html"), WRITTEN);
}

const dueRows = (page: Page) => page.locator(".tome-due li").allInnerTexts();
const asks = (page: Page) => page.locator(".tome-ask").evaluateAll((els) => els.map((el) => el.getAttribute("data-prompt")));
const ready = (page: Page) => page.locator('.tome-app[data-state="ready"]').waitFor();

async function answerEvery(runner: Locator) {
  for (let index = 1; index <= 3; index++) {
    await expect.poll(() => runner.locator(".tome-count").textContent()).toBe(`${index} / 3`);
    const audio = runner.locator("tome-audio");
    const letter = (await audio.getAttribute("ref"))!.replace("item:letter-", "").toUpperCase();
    await audio.locator(".tome-play").click();
    const input = audio.locator(".tome-input");
    await expect.poll(() => input.isEnabled(), { timeout: 5000 }).toBe(true);
    await input.fill(letter);
    await input.press("Enter");
  }
}

describe.each(["phone", "desktop"] as const)("a weekly quiz for a Morse learner at %s width", (width: Width) => {
  it("is due in what's due on home and the subject home, not in Start, and clears once taken", async () => {
    const { app, page, pageErrors, open } = await startDashboard({ width, prepare: weeklyQuizzes });

    await open("/");
    await ready(page);
    expect(await page.locator(".tome-due .tome-meta").innerText()).toBe("7 items · 1 quiz");
    expect(await dueRows(page)).toEqual(["Morse code\n3 items · 2 min", "Spanish\n4 items · 3 min", "Morse code quiz\nup to 3 questions"]);
    expect(await page.locator(".tome-due-quiz").getAttribute("href")).toBe("/run/quiz?subject=morse-code");
    expect(await page.locator(".tome-start").getAttribute("href")).toBe("/run/due");
    expect(await page.locator(".tome-start small").innerText()).toBe("7 items, about 5 min");
    expect(await page.locator(".tome-subject-ask").allInnerTexts()).toEqual(["1 to ask your agent"]);

    await open("/s/morse-code");
    await ready(page);
    expect(await dueRows(page)).toEqual(["Review\n3 items · 2 min", "Morse code quiz\nup to 3 questions"]);
    expect(await page.locator(".tome-due .tome-meta").innerText()).toBe("3 items · 1 quiz");
    expect(await page.locator(".tome-due .tome-start").getAttribute("href")).toBe("/run/due?subject=morse-code");
    expect(await page.locator(".tome-due .tome-start small").innerText()).toBe("3 items, about 2 min");
    expect(await page.locator(".tome-quiz-me").count()).toBe(0);
    expect(await asks(page)).toEqual(["quiz-unwritten"]);
    const ask = page.locator('.tome-ask[data-prompt="quiz-unwritten"]');
    expect(await ask.locator("p").innerText()).toBe("A quiz is due and none is written yet. Take the app-built quiz");
    expect(await ask.locator(".tome-ask-say > span").innerText()).toBe("Write the Morse code quiz that's due.");
    expect(await ask.locator(".tome-ask-go").getAttribute("href")).toBe("/run/quiz?subject=morse-code");
    const classes = await page
      .locator(".tome-app, .tome-app *")
      .evaluateAll((els) => [...new Set(els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))))]);
    expect(classes.filter((name) => !appClasses.includes(name))).toEqual([]);

    await open("/");
    await ready(page);
    await page.locator(".tome-due-quiz").click();
    await page.waitForURL(/\/run\/quiz\?subject=morse-code$/);
    const runner = page.locator(".tome-runner");
    await expect.poll(() => runner.locator(".tome-drill-name").textContent()).toBe("Quiz");
    await answerEvery(runner);
    await expect.poll(() => runner.getAttribute("data-state")).toBe("done");
    expect(await runner.locator(".tome-score").innerText()).toBe("100%");

    await expect.poll(async () => (await app.get("/api/subjects/morse-code/quiz/due")).body).toEqual({ quiz: null });
    await runner.locator(".tome-back").click();
    await ready(page);
    await expect.poll(() => page.locator(".tome-due-quiz").count()).toBe(0);
    expect(await page.locator(".tome-due .tome-meta").innerText()).toBe("7 items");
    expect(await page.locator(".tome-subject-ask").count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
  }, 40_000);

  it("leaves what's due live: the quiz goes when one is taken in another tab", async () => {
    const { app, page, open } = await startDashboard({ width, prepare: weeklyQuizzes });
    await open("/s/morse-code");
    await ready(page);
    expect(await dueRows(page)).toEqual(["Review\n3 items · 2 min", "Morse code quiz\nup to 3 questions"]);

    const session = { subject: "morse-code", ref: "drill:quiz-2026-11-21", sessionId: "01KAQ0000000000000000000B1", schemaVersion: 2 };
    const posted = await app.post([
      { ...session, id: session.sessionId, ts: "2026-11-21T11:00:00.000Z", kind: "session.start", data: {} },
      { ...session, id: "01KAQ0000000000000000000B2", ts: "2026-11-21T11:05:00.000Z", kind: "session.end", duration: 300_000, score: 100 },
    ]);
    expect(posted.status).toBe(201);

    await expect.poll(() => dueRows(page)).toEqual(["Review\n3 items · 2 min"]);
    expect(await page.locator(".tome-prompts").count()).toBe(0);
    expect(await page.locator(".tome-quiz-me").count()).toBe(1);
  }, 30_000);
});

describe.each(["phone", "desktop"] as const)("a written Morse quiz at %s width", (width: Width) => {
  it("fills the due slot after its lesson: what's due opens it, records its session and score, and asks for none", async () => {
    const { app, page, pageErrors, open } = await startDashboard({ width, prepare: writtenWeekly });

    expect((await app.get("/api/subjects/morse-code/quiz/due")).body).toEqual({ quiz: { opened: "2026-11-16T00:00:00.000Z", quiz: "after-r" } });
    await open("/s/morse-code");
    await ready(page);
    expect(await dueRows(page)).toEqual(["Review\n3 items · 2 min", "Morse code quiz\nwritten by your agent"]);
    expect(await page.locator(".tome-prompts").count()).toBe(0);
    expect(await page.locator(".tome-quiz-me").count()).toBe(0);

    await open("/");
    await ready(page);
    expect(await page.locator(".tome-subject-ask").count()).toBe(0);
    await page.locator(".tome-due-quiz").click();
    await page.waitForURL(/\/s\/morse-code\/quizzes\/after-r\.html$/);
    for (const [id, choice] of [["k", "K"], ["r", "K"]] as const) {
      await expect.poll(() => page.locator(`#${id} .tome-exam-question`).getAttribute("data-state")).toBe("ready");
      await page.locator(`#${id}`).getByRole("button", { name: new RegExp(choice) }).click();
      await expect.poll(() => page.locator(`#${id} .tome-exam-question`).getAttribute("data-state")).toBe("answered");
    }
    await page.getByRole("button", { name: "Finish quiz" }).click();
    await expect.poll(() => page.locator(".tome-done .tome-score").count()).toBe(1);
    expect(await page.locator(".tome-done .tome-score").innerText()).toBe("50%");

    const recorded = (await app.lines("2026-11.jsonl")).filter((event) => event.ref === "quiz:after-r");
    expect(recorded.map((event) => event.kind)).toEqual(["session.start", "session.end"]);
    expect(recorded[1]).toMatchObject({ sessionId: recorded[0].id, score: 50 });
    expect((await app.get("/api/subjects/morse-code/quiz/due")).body).toEqual({ quiz: null });
    expect(pageErrors).toEqual([]);
  }, 40_000);
});
