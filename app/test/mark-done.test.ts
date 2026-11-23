import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

interface Setup {
  events?: object[];
  assessments?: object;
  status?: string;
  width?: Width;
}

async function open(path: string, { events = lessonsDone, assessments = { exams: false }, status, width = "phone" }: Setup = {}) {
  const dashboard = await startDashboard({
    width,
    prepare: async (root) => {
      const subjectFile = join(root, MORSE, "subject.json");
      const subject = JSON.parse(await readFile(subjectFile, "utf8"));
      await writeFile(subjectFile, JSON.stringify({ ...subject, settings: { assessments } }));
      if (status !== undefined) {
        const curriculumFile = join(root, MORSE, "curriculum.json");
        const curriculum = JSON.parse(await readFile(curriculumFile, "utf8"));
        curriculum.units[0].milestones[0].status = status;
        await writeFile(curriculumFile, JSON.stringify(curriculum));
      }
      await mkdir(join(root, MORSE, "events"), { recursive: true });
      await writeFile(join(root, MORSE, "events/2026-11.mark.jsonl"), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    },
  });
  const page = await dashboard.open(path);
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  return { ...dashboard, page };
}

const markButtons = (page: Page) =>
  page.locator(".tome-milestone").evaluateAll((els) =>
    els.filter((el) => el.querySelector(".tome-milestone-done")).map((el) => el.getAttribute("data-milestone")),
  );

const status = (page: Page, milestone: string) => page.locator(`[data-milestone="${milestone}"] .tome-status`).getAttribute("data-status");

async function statusEvents(root: string) {
  const dir = join(root, MORSE, "events");
  const lines = (await Promise.all((await readdir(dir)).map((file) => readFile(join(dir, file), "utf8")))).join("").split("\n");
  return lines.filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.kind === "milestone.status");
}

describe("marking a milestone done by hand", () => {
  it.each(["phone", "desktop"] as const)("with exams off, goes from the prompt to Mark done and records it (%s)", async (width) => {
    const { app, page, pageErrors } = await open("/s/morse-code", { width });

    const prompt = page.locator('.tome-ask[data-prompt="milestone-done"]');
    expect(await prompt.locator("p").innerText()).toBe("Every lesson in Copy K, M, R, S and U is done. Mark it done");
    await prompt.locator(".tome-ask-go").click();

    await page.waitForURL(/\/s\/morse-code\/curriculum#mark-first-five$/);
    const button = page.locator('[data-milestone="first-five"] .tome-milestone-done');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("mark-first-five");
    expect(await button.innerText()).toBe("Mark done");
    expect(await button.isVisible()).toBe(true);
    expect(await markButtons(page)).toEqual(["first-five"]);
    expect(await page.locator(".tome-exam").count()).toBe(0);

    await button.click();

    await expect.poll(() => status(page, "first-five")).toBe("done");
    expect(await page.locator(".tome-milestone-done").count()).toBe(0);
    const marked = await statusEvents(app.root);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ subject: "morse-code", ref: "milestone:first-five", data: { status: "done" } });

    await page.locator(".tome-tab", { hasText: "Overview" }).click();
    expect(await page.locator(".tome-prompts").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  it("keeps the button on the page and says so when the app can't record it", async () => {
    const { page } = await open("/s/morse-code/curriculum");
    await page.route("**/api/events", (route) => route.fulfill({ status: 500, body: JSON.stringify({ error: "disk full" }) }));

    await page.locator(".tome-milestone-done").click();

    expect(await page.locator('.tome-milestone .tome-notice[role="alert"]').innerText()).toBe("Couldn't mark it done. Try again.");
    expect(await page.locator(".tome-milestone-done").isEnabled()).toBe(true);
    expect(await status(page, "first-five")).toBe("current");
  });

  it.each([
    ["exams are on", { assessments: {} }],
    ["a lesson is still to do", { events: [lessonsDone[0]!] }],
    ["the milestone is already done", { status: "done" }],
    ["the milestone is skipped", { status: "skipped" }],
  ])("isn't offered when %s", async (_, setup) => {
    const { page } = await open("/s/morse-code/curriculum", setup);

    expect(await page.locator(".tome-milestone").count()).toBe(2);
    expect(await markButtons(page)).toEqual([]);
  });

  it("asks the agent, with no link, while exams are on", async () => {
    const { page } = await open("/s/morse-code", { assessments: {} });

    expect(await page.locator(".tome-ask").getAttribute("data-prompt")).toBe("exam-unwritten");
    expect(await page.locator(".tome-ask a").count()).toBe(0);
  });

  it("is offered when assessments are off altogether", async () => {
    const { page } = await open("/s/morse-code/curriculum", { assessments: { enabled: false } });

    expect(await markButtons(page)).toEqual(["first-five"]);
  });

  it("uses only theme contract classes", async () => {
    const { page } = await open("/s/morse-code/curriculum");
    await page.route("**/api/events", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.locator(".tome-milestone-done").click();
    await page.locator(".tome-notice").waitFor();

    const used = await page.evaluate(() => [...new Set([...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]))]);
    expect(used.filter((name) => !appClasses.includes(name))).toEqual([]);
  });
});
