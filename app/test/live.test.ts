import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { writeFiles } from "../../core/test/helpers.ts";
import { startDashboard } from "./browser.ts";

async function openHome() {
  const dashboard = await startDashboard();
  const page = await dashboard.open("/");
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  await page.evaluate(() => ((window as any).sameDocument = true));
  return { ...dashboard, page };
}

const subjectNames = (page: Page) => page.locator(".tome-subject-name").allInnerTexts();
const dueCount = (page: Page) => page.locator(".tome-due .tome-meta").innerText();
const todayLevel = (page: Page) => page.locator(".tome-heatmap [data-today]").getAttribute("data-level");
const sameDocument = (page: Page) => page.evaluate(() => (window as any).sameDocument === true);

function poll<T>(read: () => Promise<T>) {
  return expect.poll(read, { timeout: 4000, interval: 50 });
}

function practice(subject: string, session: string, minute: number, attempts: object[] = []) {
  const at = (offset: number) => new Date(Date.UTC(2026, 10, 21, 10, minute + offset)).toISOString();
  const base = { subject, ref: "drill:review", sessionId: session, schemaVersion: 1, data: {} };
  return [
    { ...base, id: session, kind: "session.start", ts: at(0) },
    ...attempts.map((attempt) => ({ ...base, ts: at(1), ...attempt })),
    { ...base, kind: "session.end", ts: at(2), duration: 120_000 },
  ];
}

describe("live updates on home", { timeout: 15_000 }, () => {
  it("shows a subject added while the page is open", async () => {
    const { app, page } = await openHome();
    expect(await subjectNames(page)).not.toContain("Chess");

    await writeFiles(app.root, { "subjects/chess/subject.json": { name: "Chess" } });

    await poll(() => subjectNames(page)).toContain("Chess");
    expect(await sameDocument(page)).toBe(true);
  });

  it("updates the due count and heatmap after an attempt posted from another tab", async () => {
    const { app, page } = await openHome();
    expect(await dueCount(page)).toBe("7 items");
    expect(await todayLevel(page)).toBe("2");

    const other = await page.context().newPage();
    await other.goto(`${app.url}/settings`);
    const status = await other.evaluate(async (events) => {
      const response = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(events) });
      return [response.status, await response.text()];
    }, [
      ...practice("spanish", "01M7SPAN000000000000000P01", 0, [{ kind: "attempt", ref: "item:hola", outcome: "correct", grade: 3, duration: 900 }]),
      ...practice("yoga", "01M7Y0GA000000000000000P01", 5),
    ]);
    expect(status).toEqual([201, expect.anything()]);

    await poll(() => dueCount(page)).toBe("6 items");
    await poll(() => todayLevel(page)).toBe("3");
    expect(await sameDocument(page)).toBe(true);
  });

  it("reconnects after the server restarts and catches up on what changed while it was down", async () => {
    const { app, page } = await openHome();

    await app.restart(() => writeFile(join(app.root, "subjects/yoga/subject.json"), JSON.stringify({ name: "Yoga flow" })));

    await poll(() => subjectNames(page)).toContain("Yoga flow");
    await writeFiles(app.root, { "subjects/chess/subject.json": { name: "Chess" } });
    await poll(() => subjectNames(page)).toContain("Chess");
    expect(await sameDocument(page)).toBe(true);
  });

  it("keeps reconnecting when the stream is answered with an error while the server is down", async () => {
    const { app, page } = await openHome();
    let refused = 0;
    await page.route("**/api/changes", (route) => (refused++ === 0 ? route.fulfill({ status: 502, body: "Bad gateway" }) : route.continue()));

    await app.restart(() => writeFile(join(app.root, "subjects/yoga/subject.json"), JSON.stringify({ name: "Yoga flow" })));

    await poll(() => subjectNames(page)).toContain("Yoga flow");
    expect(refused).toBeGreaterThan(1);
    expect(await sameDocument(page)).toBe(true);
  });
});
