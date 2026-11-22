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

const dueIds = async (app: { get(path: string): Promise<{ body: any }> }) =>
  ((await app.get(`/api/subjects/${SUBJECT}/due`)).body.due as { item: { id: string } }[]).map((due) => due.item.id);

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
    expect(await dueIds(app)).toEqual(expect.arrayContaining(["rojo", "gracias"]));
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
      expect.stringContaining("<tome-choice> or <tome-typed>"),
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
