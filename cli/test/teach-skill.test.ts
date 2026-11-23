import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ulid } from "../../core/src/ulid.ts";
import {
  commandLine,
  firstWrite,
  git,
  position,
  readPage,
  startScenario,
  written,
  type Scenario,
  type Upstream,
} from "./scenario.ts";

const SKILL = readFileSync(new URL("../../skill/skills/teach/SKILL.md", import.meta.url), "utf8");
const SUBJECT = "subjects/morse-code";
const ORDER = ["git pull", "tome stats --json", "tome due --json", "tome validate", "git add", "git commit", "git push"];

function lessonFinishedOnLaptop(): Upstream {
  const start = Date.parse("2026-11-22T19:00:00.000Z");
  const session = ulid(start);
  const event = (offset: number, kind: string, extra: object = {}) =>
    JSON.stringify({
      id: offset === 0 ? session : ulid(start + offset),
      ts: new Date(start + offset).toISOString(),
      subject: "morse-code",
      kind,
      ref: "lesson:0004-the-late-bump",
      sessionId: session,
      schemaVersion: 3,
      data: {},
      ...extra,
    });
  return {
    message: "chore(history): 2026-11-22 · morse-code 1 session, 2 min",
    append: {
      [`${SUBJECT}/events/2026-11.jsonl`]:
        [event(0, "session.start"), event(110_000, "lesson.completed"), event(120_000, "session.end", { duration: 120_000 })].join("\n") + "\n",
    },
  };
}

const LESSON = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>A, the short pair</title>
<style>
.pair { border-left: 3px solid var(--t-accent); padding-left: 1rem; font-family: var(--t-mono); }
</style>
</head>
<body>
<h1>A, the short pair</h1>
<p class="pair">A is di-dah: one short sound, then one long.</p>
<p>It mirrors N, which you'll meet later. Compare it with <a href="./0001-k-and-m.html">K and M</a>.</p>
<p>Read <a href="https://www.arrl.org/learning-morse-code">ARRL's guide to learning Morse</a> next. Ask me anything that's unclear.</p>
<tome-audio ref="item:letter-a" choices="A M K"></tome-audio>
<tome-drill drill="listen-six"></tome-drill>
<tome-done></tome-done>
</body>
</html>
`;

const ITEMS = [
  { id: "letter-a", type: "timed-audio", prompt: "di-dah", answer: "A", timeLimitSeconds: 5, unlockedBy: "0005-a", tags: ["letter"] },
];

const DRILL = {
  name: "Listen · six letters",
  select: { from: "unlocked", tags: ["letter"] },
  count: 12,
  format: "multiple-choice",
  timeLimits: { perItemSeconds: 4 },
};

async function nextLesson(session: Scenario) {
  await session.git("pull", "--quiet");
  const stats = await session.tome("stats", "--json");
  const due = await session.tome("due", "--json");

  const lessons = await session.list(`${SUBJECT}/lessons`);
  await session.list(`${SUBJECT}/items`);
  await session.list(`${SUBJECT}/drills`);
  await session.read(`${SUBJECT}/curriculum.json`);
  const number = String(lessons.length + 1).padStart(4, "0");
  expect(number).toBe("0005");

  await session.write(`${SUBJECT}/lessons/0005-a.html`, LESSON);
  await session.write(`${SUBJECT}/items/0005-a.json`, JSON.stringify(ITEMS, null, 2) + "\n");
  await session.write(`${SUBJECT}/drills/listen-six.json`, JSON.stringify(DRILL, null, 2) + "\n");

  const validate = await session.tome("validate");
  expect(validate.stderr).toBe("");

  await session.git("add", SUBJECT);
  await session.git("commit", "--message", "feat(morse-code): add lesson 5 (A, the short pair)");
  await session.git("push", "--quiet");
  return { stats: stats.json(), due: due.json() };
}

describe("skill/skills/teach/SKILL.md", () => {
  it("keeps the upstream credit and MIT notice", () => {
    expect(SKILL).toContain("Forked from Matt Pocock's `teach` skill under the MIT License");
    expect(readFileSync(new URL("../../skill/skills/teach/LICENSE", import.meta.url), "utf8")).toMatch(
      /^MIT License\n\nCopyright \(c\) 2026 Matt Pocock/,
    );
  });

  it("drops the self-contained workspace guidance", () => {
    expect(SKILL).not.toMatch(/localStorage|self-contained|\.\/lessons\//);
  });

  it("lists the commands in the order the scenario runs them", () => {
    const at = ORDER.map((command) => SKILL.indexOf(command));
    expect(at.every((index) => index > -1), ORDER.filter((_, i) => at[i] === -1).join(", ")).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe("teach scenario: next Morse lesson", () => {
  let session: Scenario;
  let planned: { stats: any; due: any };
  let lesson: string;
  let items: typeof ITEMS;
  let drill: typeof DRILL;

  beforeAll(async () => {
    session = await startScenario({ example: "morse", upstream: [lessonFinishedOnLaptop()] });
    planned = await nextLesson(session);
    const file = (path: string) => readFileSync(join(session.home, SUBJECT, path), "utf8");
    lesson = file("lessons/0005-a.html");
    items = JSON.parse(file("items/0005-a.json"));
    drill = JSON.parse(file("drills/listen-six.json"));
  });

  it("follows the skill's command order", () => {
    const commands = session.actions.filter((action) => action.type === "git" || action.type === "tome").map(commandLine);
    const at = ORDER.map((prefix) => commands.findIndex((command) => command.startsWith(prefix)));
    expect(at.every((index) => index > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("pulls, then reads stats and due, before writing any file", () => {
    const write = firstWrite(session.actions);
    expect(write).toBeGreaterThan(-1);
    for (const prefix of ["git pull", "tome stats --json", "tome due --json"]) {
      expect(position(session.actions, prefix), prefix).toBeGreaterThan(-1);
      expect(position(session.actions, prefix), prefix).toBeLessThan(write);
    }
    expect(position(session.actions, "git pull")).toBeLessThan(position(session.actions, "tome stats"));
  });

  it("plans from history that includes what the app pushed", () => {
    expect(planned.stats.sessions).toBe(5);
    expect(planned.due.items.length).toBeGreaterThan(0);
  });

  it("passes tome validate before committing", () => {
    const validate = session.actions.find((action) => action.type === "tome" && action.args[0] === "validate");
    expect(validate?.type === "tome" && validate.code).toBe(0);
    expect(position(session.actions, "tome validate")).toBeLessThan(position(session.actions, "git commit"));
    expect(position(session.actions, "tome validate")).toBeGreaterThan(session.actions.findLastIndex((action) => action.type === "write"));
  });

  it("ships the lesson with its items and drill", () => {
    expect(written(session.actions)).toEqual([
      `${SUBJECT}/lessons/0005-a.html`,
      `${SUBJECT}/items/0005-a.json`,
      `${SUBJECT}/drills/listen-six.json`,
    ]);
  });

  it("logs only through the CLI", () => {
    expect(written(session.actions).filter((path) => path.includes("/events/"))).toEqual([]);
  });

  it("unlocks every item the lesson shows by that lesson", () => {
    const page = readPage(lesson);
    const shown = page.refs.filter((ref) => ref.startsWith("item:")).map((ref) => ref.slice(5));
    expect(shown).toEqual(["letter-a"]);
    for (const id of shown) expect(items.find((item) => item.id === id)?.unlockedBy).toBe("0005-a");
    expect(items.every((item) => item.unlockedBy === "0005-a")).toBe(true);
  });

  it("runs a drill that draws the lesson's items", () => {
    const page = readPage(lesson);
    expect(page.drills).toEqual(["listen-six"]);
    const tags = new Set(items.flatMap((item) => item.tags));
    expect(drill.select.tags.some((tag) => tags.has(tag))).toBe(true);
  });

  it("builds the lesson from widgets and ends it with tome-done", () => {
    const page = readPage(lesson);
    expect(page.unknownTags).toEqual([]);
    expect(page.widgets).toEqual(["tome-audio", "tome-drill", "tome-done"]);
  });

  it("styles the lesson only with theme tokens", () => {
    expect(readPage(lesson).colours).toEqual([]);
    expect(lesson).toContain("var(--t-accent)");
  });

  it("commits in the learning home's style and pushes", async () => {
    const message = await git(session.home, ["log", "-1", "--format=%B"]);
    expect(message).toMatch(/^feat\(morse-code\): add lesson 5 \(A, the short pair\)$/);
    expect(message).not.toMatch(/Co-Authored-By|Generated with/i);
    expect(await git(session.remote, ["rev-parse", "main"])).toBe(await git(session.home, ["rev-parse", "HEAD"]));
    expect(await git(session.home, ["status", "--porcelain"])).toBe("");
  });
});

describe("readPage", () => {
  it("finds hard-coded colours in styles", () => {
    const page = readPage(`<style>.x { color: #9a3b1e; background: rgb(0 0 0); border-color: white; }</style><a href="#q1">q1</a>`);
    expect(page.colours).toEqual(["#9a3b1e", "rgb(", "white"]);
  });

  it("flags tome- tags that aren't widgets", () => {
    expect(readPage(`<tome-quiz></tome-quiz><tome-done></tome-done>`).unknownTags).toEqual(["tome-quiz"]);
  });
});
