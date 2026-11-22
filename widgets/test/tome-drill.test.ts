import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locator } from "playwright";
import { type LearningEvent, startWidgetApp } from "./browser.ts";
import { expectThemeable } from "./answers.ts";

const kinds = (events: LearningEvent[]) => events.map((event) => event.kind);
const attempts = (events: LearningEvent[]) => events.filter((event) => event.kind === "attempt");

const MORSE = "subjects/morse-code";
const SPANISH = "subjects/spanish";

function hostPage(subject: string, drill: string, widget = "<tome-drill></tome-drill>"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Drill</title>
<meta name="tome-subject" content="${subject}">
<meta name="tome-page-kind" content="drill">
<meta name="tome-drill" content="${drill}">
<script type="module" src="/widgets/v1/tome.js"></script>
</head>
<body>
${widget}
</body>
</html>`;
}

function completed(subject: string, lessons: string[], schemaVersion: number): string {
  return lessons
    .map((lesson, index) =>
      JSON.stringify({
        id: `01KE0000000000000000000C${index}0`,
        ts: `2026-01-0${index + 1}T10:00:00.000Z`,
        subject,
        kind: "lesson.completed",
        ref: `lesson:${lesson}`,
        sessionId: `01KE0000000000000000000S${index}0`,
        schemaVersion,
        data: {},
      }),
    )
    .join("\n");
}

interface DrillPage {
  subject: string;
  dir: string;
  drill: string;
  lessons: string[];
  schemaVersion: number;
  widget?: string;
  drillFile?: (current: Record<string, unknown> | undefined) => Record<string, unknown>;
  prepare?: (root: string) => Promise<void>;
  touch?: boolean;
}

async function openDrill({ subject, dir, drill, lessons, schemaVersion, widget, drillFile, prepare, touch }: DrillPage) {
  const app = await startWidgetApp({
    context: touch ? { hasTouch: true, isMobile: true } : undefined,
    prepare: async (root) => {
      const events = join(root, dir, "events");
      await rm(events, { recursive: true, force: true });
      if (lessons.length > 0) {
        await mkdir(events, { recursive: true });
        await writeFile(join(events, "2026-01.jsonl"), completed(subject, lessons, schemaVersion) + "\n");
      }
      if (drillFile) {
        const file = join(root, dir, "drills", `${drill}.json`);
        const current = await readFile(file, "utf8").then(JSON.parse, () => undefined);
        await mkdir(join(root, dir, "drills"), { recursive: true });
        await writeFile(file, JSON.stringify(drillFile(current)));
      }
      await mkdir(join(root, dir, "reference"), { recursive: true });
      await writeFile(join(root, dir, "reference", "drill.html"), hostPage(subject, drill, widget));
      await prepare?.(root);
    },
  });
  const page = await app.open(`/s/${subject}/reference/drill.html`);
  const root = page.locator("tome-drill");
  await expect.poll(() => root.locator(".tome-drill").getAttribute("data-state")).not.toBe("loading");
  return { ...app, page, root };
}

const morse = (options: Partial<DrillPage> = {}) =>
  openDrill({
    subject: "morse-code",
    dir: MORSE,
    drill: "listen-kmrsu",
    lessons: ["0001-k-and-m", "0002-r"],
    schemaVersion: 2,
    widget: `<tome-drill drill="listen-kmrsu" payload='{"wpm":20}'></tome-drill>`,
    drillFile: (current) => ({ ...current, count: 4 }),
    ...options,
  });

const spanish = (options: Partial<DrillPage> = {}) =>
  openDrill({ subject: "spanish", dir: SPANISH, drill: "review", lessons: ["0001-greetings", "answers"], schemaVersion: 1, ...options });

const currentRef = (root: Locator) => root.locator(".tome-drill-item > [ref]").getAttribute("ref");
const letterOf = (ref: string | null) => ref!.replace("item:letter-", "").toUpperCase();

async function waitForItem(root: Locator, index: number, total: number) {
  await expect.poll(() => root.locator(".tome-count").textContent()).toBe(`${index} / ${total}`);
}

describe("<tome-drill>", () => {
  it("runs the Morse drill by touch: unlocked letters, count, multiple-choice format, one attempt per answer", async () => {
    const { page, root, eventsUntil } = await morse({ touch: true });
    expect(await root.locator(".tome-drill-name").textContent()).toBe("Listen · K M R S U");

    const refs: string[] = [];
    for (let i = 0; i < 4; i++) {
      await waitForItem(root, i + 1, 4);
      const audio = root.locator("tome-audio");
      await expect.poll(() => audio.locator(".tome-answer").count()).toBe(3);
      expect(await audio.getAttribute("choices")).toBe("K M R");
      const ref = (await currentRef(root))!;
      refs.push(ref);
      if (i === 0) await audio.locator(".tome-play").tap();
      const wanted = i === 0 ? (letterOf(ref) === "K" ? "M" : "K") : letterOf(ref);
      const button = audio.locator(`.tome-answer[data-choice="${wanted}"]`);
      await expect.poll(() => button.isEnabled()).toBe(true);
      await button.tap();
      await root.locator(".tome-next").tap();
    }

    await expect.poll(() => root.locator(".tome-drill").getAttribute("data-state")).toBe("done");
    expect(await root.locator(".tome-score").textContent()).toBe("75%");
    expect(await root.locator(".tome-score-sub").textContent()).toBe("3 of 4 right");
    expect(await root.locator(".tome-stats").textContent()).toContain(letterOf(refs[0]!));

    const events = await eventsUntil("morse-code", (events) => events.some((event) => event.kind === "session.end"));
    expect(kinds(events)).toEqual(["lesson.completed", "lesson.completed", "session.start", ...Array(4).fill("attempt"), "session.end"]);
    const start = events.find((event) => event.kind === "session.start")!;
    expect(start.ref).toBe("drill:listen-kmrsu");
    expect(attempts(events).map((event) => event.ref)).toEqual(refs);
    for (const attempt of attempts(events)) {
      expect(attempt.sessionId).toBe(start.id);
      expect(attempt.data).toMatchObject({ wpm: 20 });
    }
    expect(attempts(events).map((event) => event.outcome)).toEqual(["wrong", "correct", "correct", "correct"]);
    expect(new Set(refs.slice(0, 3)).size).toBe(3);
    expect(refs.every((ref) => ["item:letter-k", "item:letter-m", "item:letter-r"].includes(ref))).toBe(true);
    expect(page.url()).toContain("/reference/drill.html");
  }, 20_000);

  it("runs the built-in review by keyboard, each item in its own widget", async () => {
    const { page, root, eventsUntil } = await spanish();
    expect(await root.locator(".tome-drill-name").textContent()).toBe("Review everything due");
    await waitForItem(root, 1, 4);

    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await waitForItem(root, i + 1, 4);
      const widget = root.locator(".tome-drill-item > *");
      const tag = await widget.evaluate((element) => element.localName);
      seen.push(`${tag} ${await widget.getAttribute("ref")}`);
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest(".tome-drill-item") !== null)).toBe(true);
      if (tag === "tome-flashcard") {
        await page.keyboard.press("Enter");
        await expect.poll(() => widget.locator(".tome-grade").count()).toBe(4);
        await page.keyboard.press("3");
      } else if (tag === "tome-choice") {
        await page.keyboard.press("2");
      } else {
        await page.keyboard.type("gracias");
        await page.keyboard.press("Enter");
      }
      await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toBe("tome-next");
      await page.keyboard.press("Enter");
    }

    expect(seen).toEqual([
      "tome-flashcard item:hola",
      "tome-flashcard item:adios",
      "tome-choice item:rojo",
      "tome-typed item:gracias",
    ]);
    await expect.poll(() => root.locator(".tome-drill").getAttribute("data-state")).toBe("done");
    expect(await root.locator(".tome-score-sub").textContent()).toBe("4 of 4 right");
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("tome-again");

    const events = await eventsUntil("spanish", (events) => events.some((event) => event.kind === "session.end"));
    const start = events.find((event) => event.kind === "session.start")!;
    expect(start.ref).toBe("drill:review");
    expect(attempts(events).map((event) => [event.ref, event.grade, event.sessionId])).toEqual([
      ["item:hola", 3, start.id],
      ["item:adios", 3, start.id],
      ["item:rojo", 3, start.id],
      ["item:gracias", 3, start.id],
    ]);
  });

  it("shows an empty state when nothing is due", async () => {
    const { root, events } = await spanish({ lessons: [] });
    expect(await root.locator(".tome-drill").getAttribute("data-state")).toBe("empty");
    expect(await root.locator(".tome-empty-title").textContent()).toBe("Nothing is due");
    expect(await root.locator(".tome-drill-item").count()).toBe(0);
    expect(await events("spanish")).toEqual([]);
  });

  it("follows the drill's tags and count", async () => {
    const colour = (id: string, tags: string[]) => ({
      id,
      type: "multiple-choice",
      prompt: `Which word is ${id}?`,
      choices: [id, "otro"],
      answer: id,
      unlockedBy: "answers",
      tags,
    });
    const { root } = await spanish({
      drill: "colours",
      drillFile: () => ({ name: "Colours", select: { from: "unlocked", tags: ["colour"] }, count: 2 }),
      prepare: (root) =>
        writeFile(
          join(root, SPANISH, "items", "colours.json"),
          JSON.stringify([colour("azul", ["colour"]), colour("verde", ["colour", "nature"]), colour("perro", ["animal"])]),
        ),
    });
    const refs = new Set<string | null>();
    for (let i = 0; i < 2; i++) {
      await waitForItem(root, i + 1, 2);
      refs.add(await currentRef(root));
      await root.locator(".tome-skip").click();
      await root.locator(".tome-next").click();
    }
    expect([...refs].sort()).toEqual(["item:azul", "item:verde"]);
    await expect.poll(() => root.locator(".tome-drill").getAttribute("data-state")).toBe("done");
  });

  it("times out each item type after the per-item limit and moves on", async () => {
    const { root, eventsUntil } = await spanish({
      drill: "quick",
      drillFile: () => ({ name: "Quick", select: { from: "unlocked", tags: [] }, timeLimits: { perItemSeconds: 0.5 } }),
    });
    await root.locator(".tome-drill-item").click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 4; i++) {
      await waitForItem(root, i + 1, 4);
      await root.locator(".tome-next").click();
    }

    const events = await eventsUntil("spanish", (events) => events.some((event) => event.kind === "session.end"));
    expect(attempts(events).map((event) => [event.outcome, event.grade])).toEqual(Array(4).fill(["skipped", 1]));
    expect(attempts(events).map((event) => event.ref).sort()).toEqual(["item:adios", "item:gracias", "item:hola", "item:rojo"]);
    expect(await root.locator(".tome-drill").getAttribute("data-state")).toBe("done");
    expect(await root.locator(".tome-stats").textContent()).toContain("Skipped or out of time4");
  });

  it("holds Morse answers to the per-item limit once the sound has played", async () => {
    const { root, eventsUntil } = await morse({ drillFile: (current) => ({ ...current, count: 1, timeLimits: { perItemSeconds: 0.5 } }) });
    const audio = root.locator("tome-audio");
    await expect.poll(() => audio.locator(".tome-play").count()).toBe(1);
    await audio.locator(".tome-play").click();

    const events = await eventsUntil("morse-code", (events) => attempts(events).length === 1);
    const [attempt] = attempts(events);
    expect(attempt).toMatchObject({ outcome: "skipped", grade: 1, data: { answer: "", wpm: 20 } });
    expect(attempt!.duration).toBeGreaterThanOrEqual(500);
    expect(attempt!.duration).toBeLessThan(2000);
  });

  it("ends the run when the total time is up", async () => {
    const { root, eventsUntil } = await spanish({
      drill: "timed",
      drillFile: () => ({ name: "Timed", select: { from: "unlocked", tags: [] }, timeLimits: { totalSeconds: 1 } }),
    });
    expect(await root.locator(".tome-clock").textContent()).toBe("0:01");
    await root.locator(".tome-drill-item").click({ position: { x: 1, y: 1 } });

    const events = await eventsUntil("spanish", (events) => events.some((event) => event.kind === "session.end"));
    expect(attempts(events)).toEqual([]);
    expect(await root.locator(".tome-drill").getAttribute("data-state")).toBe("done");
    expect(await root.locator(".tome-kicker").last().textContent()).toBe("Time's up");
    expect(await root.locator(".tome-stats").textContent()).toContain("Answered0 of 4");
  });

  it("links close and hands the summary to a host that takes tome-drill-done", async () => {
    const { page, root, eventsUntil } = await spanish({
      lessons: ["answers"],
      widget: `<tome-drill close="/"></tome-drill>
<script>
document.addEventListener("tome-drill-done", (event) => {
  event.preventDefault();
  window.done = event.detail;
});
</script>`,
    });
    expect(await root.locator(".tome-drill-bar > .tome-close").getAttribute("href")).toBe("/");
    expect(await root.locator(".tome-close").getAttribute("aria-label")).toBe("End session");
    for (let i = 0; i < 2; i++) {
      await waitForItem(root, i + 1, 2);
      await root.locator(".tome-skip").click();
      await root.locator(".tome-next").click();
    }

    await expect.poll(() => root.locator(".tome-drill").getAttribute("data-state")).toBe("done");
    expect(await root.locator(".tome-summary").count()).toBe(0);
    const events = await eventsUntil("spanish", (events) => events.some((event) => event.kind === "session.end"));
    const end = events.find((event) => event.kind === "session.end")!;
    const done = await page.evaluate(() => (window as any).done);
    expect(done).toMatchObject({ drill: "review", planned: 2, timeUp: false, session: { sessionId: end.sessionId, duration: end.duration } });
    expect(done.results.map((result: { ref: string; outcome: string; grade: number }) => [result.ref, result.outcome, result.grade]).sort()).toEqual([
      ["item:gracias", "skipped", 1],
      ["item:rojo", "skipped", 1],
    ]);
  });

  it("ends a session that was still starting when the page ended it", async () => {
    const { page, eventsUntil } = await spanish({ lessons: [] });

    const ended = await page.evaluate(`(async () => {
      const { tome } = await import("/widgets/v1/tome.js");
      const starting = tome.start();
      const result = tome.end();
      await starting;
      return result ?? null;
    })()`);

    expect(ended).toBeNull();
    const events = await eventsUntil("spanish", (events) => events.some((event) => event.kind === "session.end"));
    expect(kinds(events)).toEqual(["session.start", "session.end"]);
    expect(events[1]).toMatchObject({ sessionId: events[0]!.id, ref: "drill:review" });
  });

  it("names an unknown drill", async () => {
    const { root } = await spanish({ drill: "nope", widget: `<tome-drill drill="nope"></tome-drill>` });
    expect(await root.locator(".tome-notice").textContent()).toBe('No drill "nope" in Spanish. Drills: review.');
  });

  it("renders in the light DOM with .tome-* classes and --t-* tokens", async () => {
    const { page, root } = await spanish({ lessons: ["answers"] });
    for (let i = 0; i < 2; i++) {
      await waitForItem(root, i + 1, 2);
      await root.locator(".tome-skip").click();
      await root.locator(".tome-next").click();
    }
    await expect.poll(() => root.locator(".tome-drill").getAttribute("data-state")).toBe("done");
    await expectThemeable(page, root, [
      "tome-drill",
      "tome-drill-bar",
      "tome-kicker",
      "tome-drill-name",
      "tome-count",
      "tome-progress",
      "tome-summary",
      "tome-score",
      "tome-stats",
      "tome-again",
    ]);
  });
});
