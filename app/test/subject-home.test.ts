import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { appClasses } from "@tomewise/core";
import { startDashboard, type Width } from "./browser.ts";

const MORSE = "subjects/morse-code";

async function write(root: string, files: Record<string, unknown>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  }
}

function session(id: string, ts: string, minutes: number) {
  const start = { id: `01KAZ000000000000000000${id}S`, ts, subject: "morse-code", kind: "session.start", ref: "drill:review", schemaVersion: 2, data: {} };
  const end = {
    ...start,
    id: `01KAZ000000000000000000${id}E`,
    ts: new Date(Date.parse(ts) + minutes * 60_000).toISOString(),
    kind: "session.end",
    duration: minutes * 60_000,
  };
  return [{ ...start, sessionId: start.id }, { ...end, sessionId: start.id }];
}

const lines = (events: object[]) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";

async function morseWithMore(root: string) {
  await write(root, {
    [`${MORSE}/subject.json`]: {
      ...JSON.parse(await readFile(join(root, MORSE, "subject.json"), "utf8")),
      goals: [{ id: "daily", per: "day", minutes: 10 }],
    },
    [`${MORSE}/curriculum.json`]: {
      units: [
        {
          title: "Koch letters",
          milestones: [
            {
              id: "first-five",
              title: "Copy K, M, R, S and U",
              status: "current",
              lessons: ["0001-k-and-m", "0002-r", "0003-s", "0004-the-late-bump"],
              exam: "first-five",
            },
          ],
        },
        { title: "More letters", milestones: [{ id: "next-five", title: "Copy the next five letters", status: "upcoming", lessons: ["0005-a"], reference: ["a-and-n"] }] },
      ],
    },
    [`${MORSE}/lessons/0005-a.html`]: "<h1>A</h1>",
    [`${MORSE}/lessons/0006-spacing.html`]: "<h1>Spacing</h1>",
    [`${MORSE}/items/0005-a.json`]: [{ id: "letter-a", type: "timed-audio", prompt: "A", answer: "A", unlockedBy: "0005-a", tags: ["second-five"] }],
    [`${MORSE}/drills/listen-a.json`]: { name: "Listen · A N", select: { from: "unlocked", tags: ["second-five"] }, count: 12 },
    [`${MORSE}/reference/wpm-timing.html`]: "<h1>How WPM timing works</h1>",
    [`${MORSE}/reference/a-and-n.html`]: "<h1>A and N side by side</h1>",
    [`${MORSE}/events/2026-11.fixture.jsonl`]: lines([
      ...session("01", "2026-11-16T08:00:00.000Z", 12),
      ...session("02", "2026-11-18T08:00:00.000Z", 4),
      ...session("03", "2026-11-21T08:00:00.000Z", 6),
    ]),
  });
}

async function openSubject(path: string, width: Width = "phone", prepare: (root: string) => Promise<void> = morseWithMore) {
  const dashboard = await startDashboard({ width, prepare });
  const page = await dashboard.open(path);
  await page.locator('.tome-app[data-state="ready"]').waitFor();
  return { ...dashboard, page };
}

const texts = (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim()));

const contents = (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => el.textContent));

const selectedTab = (page: Page) => page.locator('.tome-tab[aria-selected="true"]').innerText();
const visiblePanels = (page: Page) =>
  page.locator('[role="tabpanel"]').evaluateAll((els) => els.filter((el) => !(el as HTMLElement).hidden).map((el) => el.getAttribute("data-view")));

describe("subject home tabs", () => {
  it.each([
    ["/s/morse-code", "Overview", "overview"],
    ["/s/morse-code/curriculum", "Curriculum", "curriculum"],
    ["/s/morse-code/drills", "Drills", "drills"],
    ["/s/morse-code/reference", "Reference", "reference"],
    ["/s/morse-code/stats", "Stats", "stats"],
  ])("opens %s on the %s tab", async (path, tab, view) => {
    const { page, pageErrors } = await openSubject(path);

    expect(await texts(page, ".tome-title")).toEqual(["M\nMorse code"]);
    expect(await selectedTab(page)).toBe(tab);
    expect(await visiblePanels(page)).toEqual([view]);
    expect(pageErrors).toEqual([]);
  });

  it("gives each tab its own address, without reloading the page", async () => {
    const { page } = await openSubject("/s/morse-code");
    await page.evaluate(() => ((window as any).sameDocument = true));

    await page.locator(".tome-tab", { hasText: "Drills" }).click();

    await page.waitForURL(/\/s\/morse-code\/drills$/);
    expect(await visiblePanels(page)).toEqual(["drills"]);
    await page.locator(".tome-tab", { hasText: "Overview" }).click();
    await page.waitForURL(/\/s\/morse-code$/);
    expect(await page.evaluate(() => (window as any).sameDocument)).toBe(true);
  });

  it("moves between tabs with the arrow, Home and End keys", async () => {
    const { page } = await openSubject("/s/morse-code");

    await page.locator('.tome-tab[aria-selected="true"]').focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.url()).toMatch(/\/curriculum$/);
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("Curriculum");
    await page.keyboard.press("End");
    await expect.poll(() => page.url()).toMatch(/\/stats$/);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.url()).toMatch(/\/s\/morse-code$/);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.url()).toMatch(/\/stats$/);
    await page.keyboard.press("Home");
    await expect.poll(() => page.url()).toMatch(/\/s\/morse-code$/);
    await expect
      .poll(() => page.locator(".tome-tab").evaluateAll((els) => els.map((el) => el.getAttribute("tabindex"))))
      .toEqual(["0", "-1", "-1", "-1", "-1"]);
  });

  it("links back to today", async () => {
    const { page } = await openSubject("/s/morse-code/drills");

    expect(await page.locator(".tome-header .tome-home-link").getAttribute("href")).toBe("/");
  });

  it("says when there's no such tab", async () => {
    const { open } = await startDashboard();

    const page = await open("/s/morse-code/nothing");

    await expect.poll(() => page.locator(".tome-title").textContent()).toBe("Not found");
  });
});

const tops = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));

const levels = (page: Page) =>
  page
    .locator(".tome-heatmap [data-level]")
    .evaluateAll((els) => Object.fromEntries(els.map((el) => [el.getAttribute("data-date"), el.getAttribute("data-level")])));

describe.each(["phone", "desktop"] as const)("overview at %s width", (width) => {
  it("shows today's minutes against the daily goal, and the week so far", async () => {
    const { page } = await openSubject("/s/morse-code", width);

    expect(await texts(page, ".tome-goal .tome-meta")).toEqual(["10 min a day"]);
    expect(await texts(page, ".tome-goal-num")).toEqual(["6\nof 10 min today · 4 to go"]);
    expect(await page.locator(".tome-goal-bar").getAttribute("aria-label")).toBe("6 of 10 minutes");
    expect(await page.locator(".tome-goal-bar span").evaluate((el) => (el as HTMLElement).style.width)).toBe("60%");
    const week = await page
      .locator(".tome-goal-week span")
      .evaluateAll((els) => els.map((el) => [el.textContent, el.querySelector("[data-met]") ? "met" : el.querySelector("[data-part]") ? "part" : "", el.hasAttribute("data-today")]));
    expect(week).toEqual([
      ["M", "met", false],
      ["T", "", false],
      ["W", "part", false],
      ["T", "", false],
      ["F", "", false],
      ["S", "part", true],
      ["S", "", false],
    ]);
    expect(await page.locator(".tome-goal-week").getAttribute("aria-label")).toBe("This week: goal met Monday");
  });

  it("draws only this subject's activity days, darkest on the longest day", async () => {
    const { page } = await openSubject("/s/morse-code", width);

    expect(await levels(page)).toEqual({
      "2026-10-30": "1",
      "2026-11-02": "1",
      "2026-11-05": "1",
      "2026-11-08": "1",
      "2026-11-16": "4",
      "2026-11-18": "2",
      "2026-11-21": "2",
    });
    expect(await page.locator(".tome-activity .tome-meta").innerText()).toMatch(/· 1 day in a row$/);
  });

  it("offers a Start for what's due here, running this subject's review", async () => {
    const { page } = await openSubject("/s/morse-code", width);

    expect(await texts(page, ".tome-due .tome-meta")).toEqual(["3 items"]);
    expect(await texts(page, ".tome-due li")).toEqual(["Review\n3 items · 2 min"]);
    const start = page.locator(".tome-due .tome-start");
    expect(await start.innerText()).toMatch(/^Start Morse code\s+3 items, about 2 min$/);
    expect(await start.getAttribute("href")).toBe("/run/due?subject=morse-code");
  });

  it("links the first lesson not yet completed, then the last one once all are", async () => {
    const { page, app } = await openSubject("/s/morse-code", width);
    const lessons = ["0001-k-and-m", "0002-r", "0003-s", "0004-the-late-bump", "0005-a", "0006-spacing"];
    const { completedLessons } = (await (await fetch(`${app.url}/api/subjects/morse-code/progress`)).json()) as { completedLessons: string[] };
    const next = lessons.find((lesson) => !completedLessons.includes(lesson))!;

    const section = page.locator(".tome-next-lesson");
    expect(await section.getAttribute("data-lesson")).toBe(next);
    expect(await section.getAttribute("data-done")).toBeNull();
    expect(await texts(page, ".tome-next-lesson h3")).toEqual(["Next lesson"]);
    expect(await texts(page, ".tome-next-lesson .tome-meta")).toEqual([`${completedLessons.length} of 6 lessons done`]);
    expect(await section.locator(".tome-start").getAttribute("href")).toBe(`/s/morse-code/lessons/${next}.html`);
    expect(await section.locator(".tome-start").innerText()).toMatch(new RegExp(`^Open lesson ${Number(next.slice(0, 4))}\\s`));

    const left = lessons.filter((lesson) => !completedLessons.includes(lesson));
    for (const [index, lesson] of left.entries()) {
      const posted = await app.post({
        id: `01KAZ0000000000000000000C${index}`,
        ts: `2026-11-21T09:0${index}:00.000Z`,
        subject: "morse-code",
        kind: "lesson.completed",
        ref: `lesson:${lesson}`,
        schemaVersion: 2,
        data: {},
      });
      expect(posted.status).toBe(201);
    }

    await expect.poll(() => section.getAttribute("data-lesson")).toBe("0006-spacing");
    expect(await section.getAttribute("data-done")).toBe("");
    expect(await texts(page, ".tome-next-lesson h3")).toEqual(["Latest lesson"]);
    expect(await section.locator(".tome-start").innerText()).toMatch(/^Revisit lesson 6\s/);
  });

  it("puts goal and activity side by side only on wide screens, with due below", async () => {
    const { page } = await openSubject("/s/morse-code", width);

    const [goal] = await tops(page, ".tome-goal");
    const [activity] = await tops(page, ".tome-activity");
    const [due] = await tops(page, ".tome-due");
    if (width === "phone") expect(activity).toBeGreaterThan(goal!);
    else expect(activity).toBe(goal);
    expect(due).toBeGreaterThan(activity!);
  });

  it("doesn't scroll sideways on any tab", async () => {
    const { page } = await openSubject("/s/morse-code", width);

    for (const tab of ["Overview", "Curriculum", "Drills", "Reference", "Stats"]) {
      await page.locator(".tome-tab", { hasText: tab }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tab).toBe(true);
    }
  });
});

describe("overview of a subject with no goal or curriculum", () => {
  it("shows only that subject's days and asks for a goal", async () => {
    const { page } = await openSubject("/s/spanish");

    expect(Object.keys(await levels(page))).toEqual(["2026-11-08", "2026-11-20", "2026-11-21"]);
    expect(await texts(page, ".tome-goal .tome-hint")).toEqual(["No goal yet. Ask your agent to suggest one."]);
    expect(await page.locator(".tome-due .tome-start").getAttribute("href")).toBe("/run/due?subject=spanish");
  });

  it("has nothing to start when nothing is due", async () => {
    const { page } = await openSubject("/s/yoga");

    expect(await texts(page, ".tome-due .tome-hint")).toEqual(["Nothing due here today."]);
    expect(await page.locator(".tome-next-lesson").count()).toBe(0);
    expect(await page.locator(".tome-due .tome-start").getAttribute("aria-disabled")).toBe("true");
    expect(await page.locator(".tome-due .tome-start").getAttribute("href")).toBeNull();
  });
});

const lessonRows = (page: Page) =>
  page.locator(".tome-lessons li[data-lesson]").evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-lesson"),
      done: el.hasAttribute("data-done"),
      later: el.hasAttribute("data-later"),
      side: el.querySelector(".tome-side")!.textContent,
      href: el.querySelector("a")!.getAttribute("href"),
    })),
  );

describe("curriculum", () => {
  it("nests lessons under their milestones in order, then other lessons", async () => {
    const { page } = await openSubject("/s/morse-code/curriculum", "phone", async (root) => {
      await morseWithMore(root);
      await rm(join(root, MORSE, "exams/first-five.html"));
    });

    expect(await texts(page, ".tome-curriculum .tome-meta")).toEqual(["2 of 6 lessons done"]);
    expect(await contents(page, ".tome-unit h4")).toEqual(["Unit 1 · Koch letters", "Unit 2 · More letters", "Other lessons"]);
    expect(await texts(page, ".tome-milestone-head")).toEqual(["Copy K, M, R, S and U\nCurrent", "Copy the next five letters\nUpcoming"]);
    expect(await page.locator(".tome-status").evaluateAll((els) => els.map((el) => el.getAttribute("data-status")))).toEqual(["current", "upcoming"]);
    const lesson = (id: string, done: boolean, side: string, later = false) => ({ id, done, later, side, href: `/s/morse-code/lessons/${id}.html` });
    expect(await lessonRows(page)).toEqual([
      lesson("0001-k-and-m", true, "2 items"),
      lesson("0002-r", true, "1 item"),
      lesson("0003-s", false, "1 item"),
      lesson("0004-the-late-bump", false, "1 item"),
      lesson("0005-a", false, "after Unit 1", true),
      lesson("0006-spacing", false, ""),
    ]);
    expect(await page.locator("[data-done] .tome-check svg").count()).toBe(2);
    expect(await texts(page, ".tome-exam")).toEqual(["Exam · first five\nAsk your agent"]);
  });

  it("mutes an upcoming lesson but still opens it", async () => {
    const { page } = await openSubject("/s/morse-code/curriculum");

    const later = page.locator('[data-lesson="0005-a"] .tome-row');
    const colour = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
    expect(await colour('[data-lesson="0005-a"] .tome-row')).toBe(await colour(".tome-curriculum .tome-meta"));
    expect(await colour('[data-lesson="0003-s"] .tome-row')).not.toBe(await colour(".tome-curriculum .tome-meta"));
    await later.click();

    await page.waitForURL(/\/s\/morse-code\/lessons\/0005-a\.html$/);
    expect(await page.locator("h1").innerText()).toBe("A");
  });

  it("follows milestone.status events as they arrive", async () => {
    const { app, page } = await openSubject("/s/morse-code/curriculum");
    const mark = (n: number, milestone: string, status: string) =>
      app.post({
        id: `01KAZ0000000000000000000M${n}`,
        ts: `2026-11-21T1${n}:00:00.000Z`,
        subject: "morse-code",
        kind: "milestone.status",
        ref: `milestone:${milestone}`,
        schemaVersion: 2,
        data: { status },
      });
    const statuses = () => page.locator(".tome-status").evaluateAll((els) => els.map((el) => el.getAttribute("data-status")));
    const later = () => lessonRows(page).then((rows) => rows.filter((row) => row.later).map((row) => row.id));
    expect(await later()).toEqual(["0005-a"]);

    expect((await mark(1, "first-five", "done")).status).toBe(201);
    expect((await mark(2, "next-five", "current")).status).toBe(201);

    await expect.poll(statuses).toEqual(["done", "current"]);
    expect(await texts(page, ".tome-milestone-head")).toEqual(["Copy K, M, R, S and U\nDone", "Copy the next five letters\nCurrent"]);
    expect(await later()).toEqual([]);
  });

  it("shows every lesson as unlocked in a subject with no curriculum", async () => {
    const { page } = await openSubject("/s/spanish/curriculum", "phone", async (root) => {
      await write(root, {
        "subjects/spanish/lessons/0001-greetings.html": "<h1>Greetings</h1>",
        "subjects/spanish/lessons/0002-colours.html": "<h1>Colours</h1>",
      });
    });

    expect(await contents(page, ".tome-unit h4")).toEqual(["Lessons"]);
    expect(await page.locator(".tome-milestone-head").count()).toBe(0);
    expect((await lessonRows(page)).map(({ id, done, later }) => [id, done, later])).toEqual([
      ["0001-greetings", false, false],
      ["0002-colours", false, false],
    ]);
  });
});

describe("drills", () => {
  it("lists the subject's drills, linking each one that has an unlocked item to the runner", async () => {
    const { page } = await openSubject("/s/morse-code/drills");

    expect(await texts(page, ".tome-drills .tome-meta")).toEqual(["1 of 2 ready"]);
    expect(await texts(page, ".tome-drills li")).toEqual([
      "Listen · A N\n12 items\nAfter lesson 5",
      "Listen · K M R S U\n12 items · pick the answer · 5 s each\nRun",
    ]);
    expect(await page.locator('[data-drill="listen-kmrsu"] .tome-row').getAttribute("href")).toBe("/run?drill=listen-kmrsu&subject=morse-code");
  });

  it("dims a drill with no unlocked items and can't start it", async () => {
    const { page } = await openSubject("/s/morse-code/drills");

    const locked = page.locator('[data-drill="listen-a"]');
    expect(await locked.getAttribute("data-locked")).toBe("");
    expect(await locked.locator("a").count()).toBe(0);
    expect(await locked.locator(".tome-row").getAttribute("aria-disabled")).toBe("true");
    await locked.locator(".tome-row").click();
    expect(page.url()).toMatch(/\/s\/morse-code\/drills$/);
  });

  it("unlocks a drill as soon as its lesson is completed", async () => {
    const { app, page } = await openSubject("/s/morse-code/drills");
    const id = "01KAZ0000000000000000000C5";

    await app.post({ id, ts: "2026-11-21T10:00:00.000Z", subject: "morse-code", kind: "lesson.completed", ref: "lesson:0005-a", schemaVersion: 2, data: {} });

    await expect.poll(() => page.locator('[data-drill="listen-a"]').getAttribute("data-locked")).toBeNull();
    expect(await page.locator('[data-drill="listen-a"] .tome-row').getAttribute("href")).toBe("/run?drill=listen-a&subject=morse-code");
  });

  it("runs a drill in the SPA", async () => {
    const { page } = await openSubject("/s/morse-code/drills");

    await page.locator('[data-drill="listen-kmrsu"] .tome-row').click();

    await expect.poll(() => page.url()).toMatch(/\/run\?drill=listen-kmrsu&subject=morse-code$/);
    await page.locator(".tome-runner").waitFor();
  });
});

describe("reference", () => {
  it("lists the agent's reference sheets, each opening its page", async () => {
    const { page } = await openSubject("/s/morse-code/reference");

    expect(await texts(page, ".tome-reference li")).toEqual([
      "Glossary\n3 items · hear each one · built in\nOpen",
      "A and n\nSheet from your agent · after Unit 1\nOpen",
      "First five letters\nSheet from your agent\nOpen",
      "Wpm timing\nSheet from your agent\nOpen",
    ]);
    await page.locator('[data-sheet="wpm-timing"] .tome-row').click();

    await page.waitForURL(/\/s\/morse-code\/reference\/wpm-timing\.html$/);
    expect(await page.locator("h1").innerText()).toBe("How WPM timing works");
  });

  it("mutes a sheet in an upcoming milestone but still opens it", async () => {
    const { page } = await openSubject("/s/morse-code/reference");

    const colour = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
    expect(await page.locator(".tome-reference [data-later]").evaluateAll((els) => els.map((el) => el.getAttribute("data-sheet")))).toEqual(["a-and-n"]);
    expect(await colour('[data-sheet="a-and-n"] .tome-drill-name')).toBe(await colour(".tome-reference .tome-meta"));
    expect(await colour('[data-sheet="wpm-timing"] .tome-drill-name')).not.toBe(await colour(".tome-reference .tome-meta"));
    await page.locator('[data-sheet="a-and-n"] .tome-row').click();

    await page.waitForURL(/\/s\/morse-code\/reference\/a-and-n\.html$/);
    expect(await page.locator("h1").innerText()).toBe("A and N side by side");
  });

  it("stops muting a sheet once a milestone.status event moves its milestone on", async () => {
    const { app, page } = await openSubject("/s/morse-code/reference");
    const later = () => page.locator(".tome-reference [data-later]").count();
    expect(await later()).toBe(1);

    const marked = await app.post({
      id: "01KAZ0000000000000000000M1",
      ts: "2026-11-21T11:00:00.000Z",
      subject: "morse-code",
      kind: "milestone.status",
      ref: "milestone:next-five",
      schemaVersion: 2,
      data: { status: "current" },
    });
    expect(marked.status).toBe(201);

    await expect.poll(later).toBe(0);
  });

  it("lists the glossary first, opening it in the SPA", async () => {
    const { page } = await openSubject("/s/morse-code/reference");
    await page.evaluate(() => ((window as any).stayed = true));

    await page.locator('.tome-reference li:first-child[data-sheet="glossary"] .tome-row').click();

    await page.waitForURL(/\/s\/morse-code\/glossary$/);
    await page.locator(".tome-glossary").waitFor();
    expect(await page.evaluate(() => (window as any).stayed)).toBe(true);
  });

  it("says when there are none", async () => {
    const { page } = await openSubject("/s/spanish/reference");

    expect(await texts(page, ".tome-reference .tome-hint")).toEqual(["No reference sheets yet."]);
  });
});

describe("wide screens", () => {
  it("put drills and reference sheets two across", async () => {
    const { page } = await openSubject("/s/morse-code/drills", "desktop", async (root) => {
      await morseWithMore(root);
      await write(root, { [`${MORSE}/reference/cheat-sheet.html`]: "<h1>Cheat sheet</h1>" });
    });

    const [first, second] = await tops(page, ".tome-drills li");
    expect(second).toBe(first);
    await page.locator(".tome-tab", { hasText: "Reference" }).click();
    const [sheet, next] = await tops(page, ".tome-reference li");
    expect(next).toBe(sheet);
  });
});

describe("subject home themes", () => {
  it("uses only the theme contract's dashboard classes on every tab", async () => {
    const { page } = await openSubject("/s/morse-code", "desktop");
    const used = new Set<string>();

    for (const tab of ["Overview", "Curriculum", "Drills", "Reference", "Stats"]) {
      await page.locator(".tome-tab", { hasText: tab }).click();
      const names = await page
        .locator(".tome-app, .tome-app *")
        .evaluateAll((els) => els.flatMap((el) => [...el.classList].filter((name) => name.startsWith("tome-"))));
      names.forEach((name) => used.add(name));
    }
    expect([...used].filter((name) => !appClasses.includes(name))).toEqual([]);
  });

  it.each([
    ["paper", "rgb(154, 59, 30)", "none"],
    ["meadow", "rgb(67, 122, 38)", "rgb(67, 122, 38)"],
  ])("styles the selected tab in %s", async (theme, accent, background) => {
    const { page } = await openSubject("/s/morse-code", "phone", async (root) => {
      await morseWithMore(root);
      const config = JSON.parse(await readFile(join(root, "tomewise.json"), "utf8"));
      await writeFile(join(root, "tomewise.json"), JSON.stringify({ ...config, theme }));
    });

    const tab = await page.locator('.tome-tab[aria-selected="true"]').evaluate((el) => {
      const style = getComputedStyle(el);
      return { shadow: style.boxShadow, background: style.backgroundColor === "rgba(0, 0, 0, 0)" ? "none" : style.backgroundColor };
    });
    expect(tab.background).toBe(background);
    if (theme === "paper") expect(tab.shadow).toContain(accent);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".tome-goal-bar span")!).backgroundColor)).toBe(accent);
  });
});
