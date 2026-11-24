import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startWidgetApp } from "./browser.ts";
import { attempts, expectThemeable, kinds, SUBJECT } from "./answers.ts";

const EXAM = "/s/spanish/exams/final.html";

async function openExam(options?: Parameters<typeof startWidgetApp>[0]) {
  const widgets = await startWidgetApp(options);
  const page = await widgets.open(EXAM);
  const colours = page.locator("tome-exam-question#colours");
  const thanks = page.locator("tome-exam-question#thanks");
  const missing = page.locator("tome-exam-question#missing");
  await expect.poll(() => colours.locator(".tome-exam-question").getAttribute("data-state")).toBe("ready");
  await expect.poll(() => thanks.locator(".tome-exam-question").getAttribute("data-state")).toBe("ready");
  return { ...widgets, page, colours, thanks, missing };
}

const HOUR = 60 * 60 * 1000;
const inTwoDays = () => new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 10);

const dueSoon = async (app: { get(path: string): Promise<{ body: any }> }) =>
  (await app.get(`/api/subjects/${SUBJECT}/due?date=${inTwoDays()}`)).body.due as { item: { id: string }; due: string | null }[];

const dueIds = async (app: { get(path: string): Promise<{ body: any }> }) => (await dueSoon(app)).map((due) => due.item.id);

describe("<tome-exam-question>", () => {
  it("shows the question and its own choices", async () => {
    const { colours } = await openExam();

    expect(await colours.locator(".tome-question p").first().textContent()).toBe("A ripe tomato is…");
    const answers = await colours.locator(".tome-answer").allTextContents();
    expect(answers.map((text) => text.trim())).toEqual(["azul1", "rojo2", "verde3"]);
    expect(await colours.locator("option").count()).toBe(0);
  });

  it("posts one correct attempt per tested item, with the question id, in a session on the exam", async () => {
    const { page, colours, eventsUntil } = await openExam();
    await page.waitForTimeout(200);

    await colours.getByRole("button", { name: /rojo/ }).click();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 2);
    const [start] = events;
    expect(kinds(events)).toEqual(["session.start", "attempt", "attempt"]);
    expect(start).toMatchObject({ ref: "exam:final" });
    const posted = attempts(events);
    expect(posted.map((attempt) => attempt.ref).sort()).toEqual(["item:gracias", "item:rojo"]);
    for (const attempt of posted) {
      expect(attempt).toMatchObject({
        sessionId: start!.id,
        outcome: "correct",
        grade: 3,
        data: { question: "colours" },
      });
      expect(attempt.duration).toBeGreaterThanOrEqual(200);
    }
    expect(posted[0]!.duration).toBe(posted[1]!.duration);
    await expect.poll(() => colours.locator(".tome-verdict").getAttribute("data-state")).toBe("correct");
    await expect.poll(() => colours.locator(".tome-exam-question").getAttribute("data-state")).toBe("answered");
  });

  it("posts wrong attempts that bring the tested items forward", async () => {
    const { app, colours, eventsUntil } = await openExam({});
    const start = await app.post({ subject: SUBJECT, kind: "session.start", ref: "lesson:answers", schemaVersion: 1 });
    const sessionId = start.body.events[0].id;
    await app.post({ subject: SUBJECT, kind: "lesson.completed", ref: "lesson:answers", schemaVersion: 1 });
    for (const ref of ["item:rojo", "item:gracias"]) {
      await app.post({ subject: SUBJECT, kind: "attempt", ref, sessionId, outcome: "correct", grade: 4, schemaVersion: 1 });
    }
    expect(await dueIds(app)).not.toContain("rojo");
    expect(await dueIds(app)).not.toContain("gracias");

    await colours.getByRole("button", { name: /azul/ }).click();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 4);
    expect(attempts(events).slice(2)).toEqual([
      expect.objectContaining({ outcome: "wrong", grade: 1, data: { question: "colours" } }),
      expect.objectContaining({ outcome: "wrong", grade: 1, data: { question: "colours" } }),
    ]);
    const forward = (await dueSoon(app)).filter((due) => ["rojo", "gracias"].includes(due.item.id));
    expect(forward.map((due) => due.item.id)).toEqual(expect.arrayContaining(["rojo", "gracias"]));
    for (const due of forward) expect(Date.parse(due.due!)).toBeLessThan(Date.now() + HOUR);
    await expect.poll(() => colours.locator(".tome-verdict").getAttribute("data-state")).toBe("wrong");
    expect(await colours.locator(".tome-verdict").textContent()).toContain("rojo");
  });

  it("grades a typed answer, accepting its alternatives", async () => {
    const { thanks, eventsUntil } = await openExam();
    const input = thanks.getByRole("textbox", { name: "Your answer" });

    await input.fill("Mil  gracias ");
    await input.press("Enter");

    const [, attempt] = await eventsUntil(SUBJECT, (events) => attempts(events).length === 1);
    expect(attempt).toMatchObject({ ref: "item:gracias", outcome: "correct", grade: 3, data: { question: "thanks" } });
  });

  it("posts skipped attempts for every tested item when skipped", async () => {
    const { colours, eventsUntil } = await openExam();

    await colours.getByRole("button", { name: "Skip" }).click();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 2);
    expect(attempts(events).map(({ outcome, grade }) => ({ outcome, grade }))).toEqual([
      { outcome: "skipped", grade: 1 },
      { outcome: "skipped", grade: 1 },
    ]);
  });

  it("shows unknown item refs in tests and can't be answered", async () => {
    const { page, missing, events } = await openExam();

    const notice = missing.locator(".tome-exam-question > .tome-notice");
    await expect.poll(() => notice.textContent()).toContain('No item "nope"');
    expect(await notice.getAttribute("role")).toBe("alert");
    expect(await missing.locator(".tome-exam-question").getAttribute("data-state")).toBe("error");

    await missing.getByRole("button", { name: /rojo/ }).click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(200);
    expect(attempts(await events(SUBJECT))).toEqual([]);
  });

  it("shows an error when it names no items, has no id or no answer", async () => {
    const { page } = await openExam({});
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<tome-exam-question id="untested"><p>?</p><tome-choice answer="a"><option>a</option></tome-choice></tome-exam-question>
         <tome-exam-question tests="item:rojo"><p>?</p><tome-choice answer="a"><option>a</option></tome-choice></tome-exam-question>
         <tome-exam-question id="unanswerable" tests="item:rojo"><p>?</p></tome-exam-question>`,
      );
    });

    const notices = page.locator("tome-exam-question .tome-exam-question > .tome-notice");
    await expect.poll(() => notices.count()).toBe(4);
    const texts = await notices.allTextContents();
    expect(texts.slice(1)).toEqual([
      expect.stringContaining("tests"),
      expect.stringContaining("id"),
      expect.stringContaining("<tome-choice>, <tome-typed> or <tome-audio>"),
    ]);
  });

  it("works by keyboard alone", async () => {
    const { page, colours, eventsUntil } = await openExam();

    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("tome-exam-question")?.id)).toBe("colours");
    await page.keyboard.press("2");

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 2);
    expect(attempts(events).every((attempt) => attempt.outcome === "correct")).toBe(true);
    await expect.poll(() => colours.locator(".tome-verdict").getAttribute("data-state")).toBe("correct");
  });

  it("works by touch", async () => {
    const { colours, eventsUntil } = await openExam({ context: { hasTouch: true, isMobile: true } });

    await colours.getByRole("button", { name: /verde/ }).tap();

    const events = await eventsUntil(SUBJECT, (events) => attempts(events).length === 2);
    expect(attempts(events).every((attempt) => attempt.outcome === "wrong" && attempt.grade === 1)).toBe(true);
  });

  it("saves only the attempts that failed when saved again", async () => {
    const { page, colours, events } = await openExam();
    let dropped = false;
    await page.route("**/api/events", (route) => {
      if (!dropped && route.request().postData()?.includes('"item:gracias"')) {
        dropped = true;
        return route.abort();
      }
      return route.continue();
    });

    await colours.getByRole("button", { name: /rojo/ }).click();

    const notice = colours.locator(".tome-notice");
    await expect.poll(() => notice.textContent()).toContain("Couldn't reach the app");
    expect(await colours.locator('.tome-answer[data-state="correct"]').textContent()).toContain("rojo");
    expect(attempts(await events(SUBJECT)).map((attempt) => attempt.ref)).toEqual(["item:rojo"]);

    await colours.getByRole("button", { name: "Save again" }).click();

    await expect.poll(async () => attempts(await events(SUBJECT)).length).toBe(2);
    expect(attempts(await events(SUBJECT)).map((attempt) => attempt.ref)).toEqual(["item:rojo", "item:gracias"]);
    await expect.poll(() => colours.locator(".tome-exam-question").getAttribute("data-state")).toBe("answered");
  });

  it("renders in the light DOM with .tome-* classes styled only by --t-* tokens", async () => {
    const { page, colours } = await openExam();

    await expectThemeable(page, colours, ["tome-exam-question", "tome-question", "tome-choice", "tome-answers"]);
  });

  it("leaves a standalone answer without an item showing why", async () => {
    const { page } = await openExam({});
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", `<tome-choice id="loose" answer="a"><option>a</option><option>b</option></tome-choice>`);
    });
    const loose = page.locator("tome-choice#loose");

    await loose.getByRole("button", { name: /a/ }).first().click();

    await expect.poll(() => loose.locator(".tome-notice").textContent()).toContain("<tome-exam-question>");
  });
});

const MORSE = "morse-code";

const MORSE_EXAM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Check</title></head><body>
<tome-exam-question id="hear-k" tests="item:letter-k item:letter-m" payload='{"wpm":20}'>
  <p>Which letter is this?</p>
  <tome-audio ref="item:letter-k" choices="K M"></tome-audio>
</tome-exam-question>
<tome-exam-question id="read-k" tests="item:letter-k">
  <p>Which letter is dah-di-dah?</p>
  <tome-choice answer="K"><option>K</option><option>M</option></tome-choice>
</tome-exam-question>
</body></html>`;

async function openMorseExam() {
  const widgets = await startWidgetApp({
    prepare: async (root) => {
      const dir = join(root, "subjects", MORSE);
      await rm(join(dir, "events"), { recursive: true, force: true });
      await mkdir(join(dir, "exams"), { recursive: true });
      await writeFile(join(dir, "exams/check.html"), MORSE_EXAM);
    },
  });
  const page = await widgets.open(`/s/${MORSE}/exams/check.html`);
  const hear = page.locator("tome-exam-question#hear-k");
  const read = page.locator("tome-exam-question#read-k");
  for (const question of [hear, read]) {
    await expect.poll(() => question.locator(".tome-exam-question").getAttribute("data-state")).toBe("ready");
  }
  return { ...widgets, page, hear, read };
}

describe("<tome-exam-question> on a subject with required attempt fields", () => {
  it("records a <tome-audio> answer with its measured fields and the question's payload, moving each tested item", async () => {
    const { app, hear, eventsUntil } = await openMorseExam();
    const start = await app.post({ subject: MORSE, kind: "session.start", ref: "lesson:0001-k-and-m", schemaVersion: 2 });
    const sessionId = start.body.events[0].id;
    await app.post({ subject: MORSE, kind: "lesson.completed", ref: "lesson:0001-k-and-m", schemaVersion: 2 });
    for (const [ref, heard] of [["item:letter-k", "K"], ["item:letter-m", "M"]]) {
      const data = { heard, answer: heard, responseTime: 400, wpm: 20 };
      await app.post({ subject: MORSE, kind: "attempt", ref, sessionId, outcome: "correct", grade: 4, schemaVersion: 2, data });
    }
    const due = async () =>
      ((await app.get(`/api/subjects/${MORSE}/due?date=${inTwoDays()}`)).body.due as { item: { id: string }; due: string | null }[])
        .filter((entry) => ["letter-k", "letter-m"].includes(entry.item.id));
    expect(await due()).toEqual([]);

    await hear.getByRole("button", { name: "Play the sound" }).click();
    const wrong = hear.getByRole("button", { name: "M" });
    await expect.poll(() => wrong.isEnabled()).toBe(true);
    await wrong.click();

    const events = await eventsUntil(MORSE, (events) => attempts(events).length === 4);
    const posted = attempts(events).slice(2);
    expect(posted.map((attempt) => attempt.ref).sort()).toEqual(["item:letter-k", "item:letter-m"]);
    for (const attempt of posted) {
      expect(attempt).toMatchObject({
        outcome: "wrong",
        grade: 1,
        data: { heard: "K", answer: "M", wpm: 20, question: "hear-k" },
      });
      expect(attempt.data.responseTime).toBeGreaterThanOrEqual(0);
    }
    await expect.poll(() => hear.locator(".tome-exam-question").getAttribute("data-state")).toBe("answered");
    expect(await hear.locator(".tome-notice").count()).toBe(0);
    const moved = await due();
    expect(moved.map((entry) => entry.item.id).sort()).toEqual(["letter-k", "letter-m"]);
    for (const entry of moved) expect(Date.parse(entry.due!)).toBeLessThan(Date.now() + HOUR);
  });

  it("shows which required field is missing when the question can't supply it", async () => {
    const { read, events } = await openMorseExam();

    await read.getByRole("button", { name: /K/ }).click();

    await expect.poll(() => read.locator('.tome-notice[data-state="unsaved"]').textContent()).toContain("heard");
    expect(attempts(await events(MORSE))).toEqual([]);
  });
});
