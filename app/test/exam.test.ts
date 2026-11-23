import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startDashboard } from "./browser.ts";

const MORSE = "subjects/morse-code";

const EXAM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>First five</title></head><body>
<h1>First five</h1>
<tome-exam-question id="k" tests="item:letter-k">
  <p>Which letter is dah-di-dah?</p>
  <tome-choice answer="K"><option>K</option><option>R</option><option>M</option></tome-choice>
</tome-exam-question>
<tome-exam-question id="r" tests="item:letter-r">
  <p>Which letter is di-dah-dit?</p>
  <tome-choice answer="R"><option>K</option><option>R</option><option>M</option></tome-choice>
</tome-exam-question>
<tome-exam-question id="m" tests="item:letter-m">
  <p>Which letter is dah-dah?</p>
  <tome-choice answer="M"><option>K</option><option>R</option><option>M</option></tome-choice>
</tome-exam-question>
<tome-done></tome-done>
</body></html>`;

function completed(n: number, lesson: string) {
  const sessionId = `01KAZ00000000000000000000${n}`;
  const at = `2026-11-20T0${n}:00:00.000Z`;
  const base = { subject: "morse-code", sessionId, schemaVersion: 2, data: {} };
  return [
    { ...base, id: sessionId, ts: at, kind: "session.start", ref: `lesson:${lesson}` },
    { ...base, id: `01KAZ0000000000000000000C${n}`, ts: at, kind: "lesson.completed", ref: `lesson:${lesson}` },
  ];
}

async function examReady(root: string) {
  const subjectFile = join(root, MORSE, "subject.json");
  const subject = JSON.parse(await readFile(subjectFile, "utf8"));
  const latest = subject.payloadSchemas.at(-1);
  const attempt = latest.kinds.attempt;
  subject.payloadSchemas.push({ version: latest.version + 1, kinds: { ...latest.kinds, attempt: { ...attempt, required: [] } } });
  await writeFile(subjectFile, JSON.stringify(subject));
  await mkdir(join(root, MORSE, "exams"), { recursive: true });
  await writeFile(join(root, MORSE, "exams/first-five.html"), EXAM);
  const events = [...completed(3, "0003-s"), ...completed(4, "0004-the-late-bump")];
  await writeFile(join(root, MORSE, "events/2026-11.exam.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

describe("the Morse exam", () => {
  it("shows milestone 1's exam as ready, and passing it marks the milestone done", async () => {
    const { app, open, pageErrors } = await startDashboard({ prepare: examReady });
    const page = await open("/s/morse-code");
    await page.locator('.tome-app[data-state="ready"]').waitFor();

    const ask = page.locator('.tome-ask[data-prompt="exam-ready"]');
    await expect.poll(() => ask.innerText()).toContain("The exam for Copy K, M, R, S and U is ready.");
    await page.locator(".tome-tab", { hasText: "Curriculum" }).click();
    expect(await page.locator(".tome-milestone-head").first().innerText()).toBe("Copy K, M, R, S and U\nCurrent");
    expect(await page.locator(".tome-exam").innerText()).toBe("Exam · first five\nReady");

    await page.locator(".tome-exam a").click();
    await page.waitForURL(/\/s\/morse-code\/exams\/first-five\.html$/);
    const question = (id: string) => page.locator(`tome-exam-question#${id}`);
    for (const [id, letter] of [["k", "K"], ["r", "R"], ["m", "M"]] as const) {
      await expect.poll(() => question(id).locator(".tome-exam-question").getAttribute("data-state")).toBe("ready");
      await question(id).getByRole("button", { name: new RegExp(`^${letter}`) }).click();
      await expect.poll(() => question(id).locator(".tome-exam-question").getAttribute("data-state")).toBe("answered");
    }
    await page.getByRole("button", { name: "Finish exam" }).click();

    const score = page.locator(".tome-exam-score");
    await expect.poll(() => score.count()).toBe(1);
    expect(await score.getAttribute("data-passed")).toBe("true");
    expect(await score.locator(".tome-score").innerText()).toBe("100%");
    expect(await score.locator(".tome-score-sub").innerText()).toBe("3 of 3 right · pass mark 70%");
    const lines = await app.lines("2026-11.jsonl");
    const events = lines.slice(lines.findIndex((event) => event.ref === "exam:first-five"));
    expect(events.map((event) => event.kind)).toEqual(["session.start", "attempt", "attempt", "attempt", "session.end", "milestone.status"]);
    expect(events.at(-2)).toMatchObject({ ref: "exam:first-five", score: 100 });
    expect(events.at(-1)).toMatchObject({ ref: "milestone:first-five", data: { status: "done" } });

    await page.goto(`${app.url}/s/morse-code/curriculum`);
    await page.locator('.tome-app[data-state="ready"]').waitFor();
    await expect.poll(() => page.locator(".tome-status").first().getAttribute("data-status")).toBe("done");
    expect(await page.locator(".tome-milestone-head").first().innerText()).toBe("Copy K, M, R, S and U\nDone");
    await page.locator(".tome-tab", { hasText: "Overview" }).click();
    expect(await page.locator('.tome-ask[data-prompt="exam-ready"]').count()).toBe(0);
    expect(pageErrors).toEqual([]);
  });
});
