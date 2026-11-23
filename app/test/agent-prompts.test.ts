import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

const MORSE = "subjects/morse-code";
const base = { subject: "morse-code", schemaVersion: 2, data: {} };

const completed = (lesson: string, index: number) => ({
  ...base,
  id: `01KAZ0000000000000000000C${index}`,
  ts: "2026-11-21T09:00:00.000Z",
  kind: "lesson.completed",
  ref: `lesson:${lesson}`,
});

const lessonsDone = [completed("0003-s", 3), completed("0004-the-late-bump", 4)];

const saved = {
  ...base,
  id: "01KAZ0000000000000000000X1",
  ts: "2026-11-21T09:05:00.000Z",
  kind: "explanation.saved",
  ref: "lesson:0004-the-late-bump",
  data: { text: "The late bump is a short gap before the last letter." },
};

const graded = {
  ...base,
  id: "01KAZ0000000000000000000G1",
  ts: "2026-11-21T10:00:00.000Z",
  kind: "explanation.graded",
  ref: `event:${saved.id}`,
  data: { feedback: "Close: it's a longer gap, so the letter lands late." },
};

async function open(path: string, events: object[] = [], width: Width = "phone") {
  const dashboard = await startDashboard({
    width,
    prepare: async (root) => {
      if (events.length === 0) return;
      await mkdir(join(root, MORSE, "events"), { recursive: true });
      await writeFile(join(root, MORSE, "events/2026-11.prompts.jsonl"), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    },
  });
  const page = await dashboard.open(path);
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  return { ...dashboard, page };
}

const prompts = (page: Page) =>
  page.locator(".tome-ask").evaluateAll((els) =>
    els.map((el) => ({
      text: (el.querySelector("p") as HTMLElement).innerText,
      say: el.querySelector(".tome-ask-say > span")?.textContent,
    })),
  );

const examUnwritten = {
  text: "Every lesson in Copy K, M, R, S and U is done. Its exam isn't written yet.",
  say: "Prepare the exam for “Copy K, M, R, S and U”.",
};
const ungraded = { text: "Your explanation from The late bump is waiting to be graded.", say: "Grade my Morse code explanation." };

describe("ask-your-agent prompts on the subject home", () => {
  it("are left out while nothing needs the agent", async () => {
    const { page } = await open("/s/morse-code");

    expect(await page.locator(".tome-prompts").count()).toBe(0);
    expect(await page.locator(".tome-explanations").count()).toBe(0);
  });

  it("say what to ask the agent, between the heatmap and what's due", async () => {
    const { page, pageErrors } = await open("/s/morse-code", [...lessonsDone, saved]);

    expect(await prompts(page)).toEqual([examUnwritten, ungraded]);
    expect(await page.locator(".tome-prompts .tome-section-head").innerText()).toMatch(/Ask your agent\s+2 waiting/);
    const order = await page.locator(".tome-overview > *").evaluateAll((els) => els.map((el) => el.classList[1]));
    expect(order).toEqual(["tome-goal", "tome-activity", "tome-prompts", "tome-due"]);
    expect(pageErrors).toEqual([]);
  });

  it("come and go as the state changes", async () => {
    const { app, page } = await open("/s/morse-code");

    await app.post([...lessonsDone, saved]);
    await expect.poll(() => prompts(page)).toEqual([examUnwritten, ungraded]);

    await mkdir(join(app.root, MORSE, "exams"), { recursive: true });
    await writeFile(join(app.root, MORSE, "exams/first-five.html"), "<h1>Exam</h1>");
    await expect.poll(() => prompts(page)).toEqual([
      { text: "The exam for Copy K, M, R, S and U is ready. Take the exam", say: "Go over my exam results for “Copy K, M, R, S and U”." },
      ungraded,
    ]);
    expect(await page.locator(".tome-ask-go").getAttribute("href")).toBe("/s/morse-code/exams/first-five.html");

    await app.post(graded);
    await expect.poll(() => prompts(page)).toHaveLength(1);

    const curriculum = JSON.parse(await readFile(join(app.root, MORSE, "curriculum.json"), "utf8"));
    curriculum.units[0].milestones[0].status = "done";
    await writeFile(join(app.root, MORSE, "curriculum.json"), JSON.stringify(curriculum));
    await expect.poll(() => page.locator(".tome-prompts").count()).toBe(0);
  });

  it("go once an event marks the milestone done, and the Curriculum tab shows it done", async () => {
    const { app, page, pageErrors } = await open("/s/morse-code", lessonsDone);
    await expect.poll(() => prompts(page)).toEqual([examUnwritten]);

    const marked = await app.post({
      ...base,
      id: "01KAZ0000000000000000000M1",
      ts: "2026-11-21T11:00:00.000Z",
      kind: "milestone.status",
      ref: "milestone:first-five",
      data: { status: "done" },
    });
    expect(marked.status).toBe(201);
    await expect.poll(() => page.locator(".tome-prompts").count()).toBe(0);

    await page.locator(".tome-tab", { hasText: "Curriculum" }).click();
    const status = page.locator('[data-milestone="first-five"] .tome-status');
    await expect.poll(() => status.getAttribute("data-status")).toBe("done");
    expect(await status.innerText()).toBe("Done");
    expect(pageErrors).toEqual([]);
  });

  it("asks to mark a milestone with no exam done", async () => {
    const { app, page } = await open("/s/morse-code", lessonsDone);
    const curriculum = JSON.parse(await readFile(join(app.root, MORSE, "curriculum.json"), "utf8"));
    delete curriculum.units[0].milestones[0].exam;
    await writeFile(join(app.root, MORSE, "curriculum.json"), JSON.stringify(curriculum));

    await expect
      .poll(() => prompts(page))
      .toEqual([{ text: "Every lesson in Copy K, M, R, S and U is done.", say: "Mark the “Copy K, M, R, S and U” milestone done." }]);
  });

  it("copies what to say", async () => {
    const { page } = await open("/s/morse-code", [saved]);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void ((window as any).copied = text) } });
    });

    await page.locator(".tome-copy").click();

    expect(await page.evaluate(() => (window as any).copied)).toBe("Grade my Morse code explanation.");
    await expect.poll(() => page.locator(".tome-copy").innerText()).toBe("Copied");
  });

  it("put prompts beside what's due on wide screens", async () => {
    const { page } = await open("/s/morse-code", [saved], "desktop");

    const [prompt, due] = await Promise.all([".tome-prompts", ".tome-due"].map((selector) => page.locator(selector).boundingBox()));
    expect(prompt!.y).toBe(due!.y);
    expect(prompt!.x).toBeLessThan(due!.x);
  });
});

describe("the agent's feedback", () => {
  it("shows next to the explanation it grades", async () => {
    const { page } = await open("/s/morse-code", [saved, graded]);

    const shown = page.locator(".tome-explanation");
    expect(await shown.count()).toBe(1);
    expect(await shown.locator(".tome-explanation-from").innerText()).toBe("The late bump");
    expect(await shown.locator(".tome-explanation-text").innerText()).toBe(saved.data.text);
    expect(await shown.locator(".tome-explanation-feedback").innerText()).toContain(graded.data.feedback);
  });

  it("appears once the agent grades an explanation", async () => {
    const { app, page } = await open("/s/morse-code", [saved]);
    expect(await page.locator(".tome-explanation").count()).toBe(0);

    await app.post(graded);

    await expect.poll(() => page.locator(".tome-explanation-feedback").count()).toBe(1);
    expect(await prompts(page)).toEqual([]);
  });
});

describe("prompts on home", () => {
  it("show on each subject waiting on the agent, and go when it's done", async () => {
    const { app, page } = await open("/", [...lessonsDone, saved]);

    const asks = () => page.locator(".tome-subject").evaluateAll((els) => els.map((el) => el.querySelector(".tome-subject-ask")?.textContent ?? null));
    expect(await page.locator(".tome-subject-name").allInnerTexts()).toEqual(["Morse code", "Spanish", "Yoga"]);
    expect(await asks()).toEqual(["2 to ask your agent", null, null]);

    await app.post(graded);
    await expect.poll(asks).toEqual(["1 to ask your agent", null, null]);
  });
});

describe("prompt classes", () => {
  it("are in the theme contract", async () => {
    const { page } = await open("/s/morse-code", [...lessonsDone, saved, graded], "desktop");
    const home = await open("/", [saved]);

    const used = async (target: Page) =>
      target.locator(".tome-app, .tome-app *").evaluateAll((els) => els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))));
    const names = [...(await used(page)), ...(await used(home.page))];
    expect(names).toEqual(expect.arrayContaining(["tome-prompts", "tome-ask", "tome-explanation", "tome-subject-ask"]));
    expect(names.filter((name) => !appClasses.includes(name))).toEqual([]);
  });
});

describe("prompts in /styleguide", () => {
  it.each(["phone", "desktop"] as const)("shows every kind of prompt and the agent's feedback at %s width", async (width) => {
    const dashboard = await startDashboard({ width });
    const page = await dashboard.open("/styleguide");
    await page.waitForFunction(() => document.documentElement.dataset.styleguide, undefined, { timeout: 15000 });

    expect(await page.evaluate(() => document.documentElement.dataset.styleguideErrors ?? "")).toBe("");
    expect(await page.locator('.styleguide-nav a[href="#prompts"]').innerText()).toBe("Prompts");
    const kinds = await page.locator("#prompts .tome-ask").evaluateAll((els) => els.map((el) => el.getAttribute("data-prompt")));
    expect(kinds).toEqual(["milestone-done", "exam-unwritten", "exam-ready", "quiz-unwritten", "ungraded-explanations"]);
    expect(await page.locator("#prompts .tome-explanation-feedback").count()).toBeGreaterThan(0);
    const overview = '#subject-home [data-styleguide-subject="overview"]';
    expect(await page.locator(`${overview} .tome-ask`).count()).toBe(2);
    expect(await page.locator(`${overview} .tome-explanation`).count()).toBe(1);
    expect(await page.locator("#home .tome-subject-ask").allInnerTexts()).toEqual(["2 to ask your agent"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(dashboard.pageErrors).toEqual([]);
  }, 20_000);
});
