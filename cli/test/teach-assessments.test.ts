import { appendFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { agentPrompts, DEFAULT_ASSESSMENTS, loadLearningHome, loadSubject, quizSlots, readEvents, type AgentPrompt } from "@tomewise/core";
import { ulid } from "../../core/src/ulid.ts";
import { git, position, readPage, startScenario, written, type Scenario, type Upstream } from "./scenario.ts";

const TEACH = new URL("../../skill/skills/teach/", import.meta.url);
const SKILL = readFileSync(new URL("SKILL.md", TEACH), "utf8");
const GUIDE = readFileSync(new URL("WRITING-ASSESSMENTS.md", TEACH), "utf8");
const EXAMPLE = new URL("../../examples/morse/subjects/morse-code/", import.meta.url);
const SUBJECT = "subjects/morse-code";
const EXAM = `${SUBJECT}/exams/first-five.html`;

type Settings = { [K in keyof typeof DEFAULT_ASSESSMENTS]: any };

function session(ref: string, start: number, middle: object[], end: object = {}): string {
  const id = ulid(start);
  const event = (offset: number, kind: string, extra: object = {}) =>
    JSON.stringify({
      id: offset === 0 ? id : ulid(start + offset),
      ts: new Date(start + offset).toISOString(),
      subject: "morse-code",
      kind,
      ref,
      sessionId: id,
      schemaVersion: 3,
      data: {},
      ...extra,
    });
  const events = [event(0, "session.start"), ...middle.map((extra, i) => event(1000 * (i + 1), (extra as any).kind, extra)), event(60_000, "session.end", { duration: 60_000, ...end })];
  return events.join("\n") + "\n";
}

const completed = (lesson: string, ts: string) => session(`lesson:${lesson}`, Date.parse(ts), [{ kind: "lesson.completed" }]);

function lessonsCompleted(): Upstream {
  return {
    message: "chore(history): 2026-11-21 · morse-code 3 sessions",
    append: {
      [`${SUBJECT}/events/2026-11.jsonl`]:
        completed("0003-s", "2026-11-20T19:00:00.000Z") +
        completed("0004-the-late-bump", "2026-11-21T19:00:00.000Z") +
        session("quiz:k-m-r", Date.parse("2026-11-21T20:00:00.000Z"), [], { score: 100 }),
    },
  };
}

function examUnwritten(): Upstream {
  return { message: "chore(morse-code): drop first-five exam draft", remove: [EXAM] };
}

function settingsChanged(assessments: Partial<Settings>): Upstream {
  const subject = JSON.parse(readFileSync(new URL("subject.json", EXAMPLE), "utf8"));
  return {
    message: "chore(morse-code): update assessment settings",
    write: { [`${SUBJECT}/subject.json`]: JSON.stringify({ ...subject, settings: { assessments } }, null, 2) + "\n" },
  };
}

const LESSON = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>A, the short pair</title>
</head>
<body>
<h1>A, the short pair</h1>
<p>A is di-dah: one short sound, then one long. Compare it with <a href="./0001-k-and-m.html">K and M</a>.</p>
<p>Read <a href="https://www.arrl.org/learning-morse-code">ARRL's guide to learning Morse</a> next. Ask me anything that's unclear.</p>
<tome-audio ref="item:letter-a" choices="A M K"></tome-audio>
<tome-drill drill="listen-kmrsu"></tome-drill>
<tome-done></tome-done>
</body>
</html>
`;

const ITEMS = [
  { id: "letter-a", type: "timed-audio", prompt: "di-dah", answer: "A", timeLimitSeconds: 5, unlockedBy: "0005-a", tags: ["letter"] },
];

const QUIZ = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="tome-after" content="lesson:0005-a">
<title>Quiz · S, U and A</title>
</head>
<body>
<h1>Quiz · S, U and A</h1>
<tome-exam-question id="q1" tests="item:letter-a">
  <p>Which letter is di-dah?</p>
  <tome-choice answer="A"><option>A</option><option>U</option><option>S</option></tome-choice>
</tome-exam-question>
<tome-exam-question id="q2" tests="item:letter-s">
  <p>Which letter is dit-dit-dit?</p>
  <tome-choice answer="S"><option>U</option><option>S</option><option>A</option></tome-choice>
</tome-exam-question>
<tome-exam-question id="q3" tests="item:letter-u">
  <p>Type the letter that is dit-dit-dah.</p>
  <tome-typed answer="U"><option>u</option></tome-typed>
</tome-exam-question>
<tome-exam-question id="q4" tests="item:letter-a item:letter-r">
  <p>Add a dit to the end of A. Which letter do you get?</p>
  <tome-choice answer="R"><option>K</option><option>U</option><option>R</option></tome-choice>
</tome-exam-question>
<tome-done></tome-done>
</body>
</html>
`;

async function assessmentSettings(session: Scenario): Promise<Settings> {
  const home = JSON.parse(await session.read("tomewise.json"));
  const subject = JSON.parse(await session.read(`${SUBJECT}/subject.json`));
  return { ...DEFAULT_ASSESSMENTS, ...home.assessments, ...subject.settings?.assessments };
}

function quizAfterLesson(settings: Settings, lesson: number): boolean {
  if (!settings.enabled || settings.quizFrequency === "onDemand") return false;
  if (settings.quizFrequency === "weekly") throw new Error("no weekly scenario");
  return lesson % settings.quizFrequency.every === 0;
}

async function nextLesson(session: Scenario) {
  await session.git("pull", "--quiet");
  await session.tome("stats", "--json");
  await session.tome("due", "--json");
  const settings = await assessmentSettings(session);

  const lessons = await session.list(`${SUBJECT}/lessons`);
  await session.list(`${SUBJECT}/items`);
  await session.list(`${SUBJECT}/quizzes`);
  const number = lessons.length + 1;
  expect(number).toBe(5);
  const quiz = quizAfterLesson(settings, number);

  await session.write(`${SUBJECT}/lessons/0005-a.html`, LESSON);
  await session.write(`${SUBJECT}/items/0005-a.json`, JSON.stringify(ITEMS, null, 2) + "\n");
  if (quiz) await session.write(`${SUBJECT}/quizzes/k-to-a.html`, QUIZ);

  expect((await session.tome("validate")).code).toBe(0);
  await session.git("add", SUBJECT);
  await session.git("commit", "--message", `feat(morse-code): add lesson 5 (A, the short pair)${quiz ? " and its quiz" : ""}`);
  await session.git("push", "--quiet");
}

async function appPrompts(root: string): Promise<AgentPrompt[]> {
  const home = await loadLearningHome(root);
  return agentPrompts(await loadSubject(home, "morse-code"), await readEvents(home, "morse-code"), new Date("2026-11-23T12:00:00.000Z"));
}

async function prepareExam(session: Scenario, request: string | undefined) {
  await session.git("pull", "--quiet");
  await session.tome("stats", "--json");
  await session.tome("due", "--json");
  const settings = await assessmentSettings(session);
  if (request === undefined || !settings.enabled || !settings.exams) return;

  const curriculum = JSON.parse(await session.read(`${SUBJECT}/curriculum.json`));
  const milestone = curriculum.units.flatMap((unit: any) => unit.milestones).find((m: any) => request.includes(`“${m.title}”`));
  await session.write(`${SUBJECT}/exams/${milestone.exam}.html`, readFileSync(new URL(`exams/${milestone.exam}.html`, EXAMPLE), "utf8"));

  expect((await session.tome("validate")).code).toBe(0);
  await session.git("add", SUBJECT);
  await session.git("commit", "--message", `feat(morse-code): add exam for ${milestone.id}`);
  await session.git("push", "--quiet");
}

const examRequest = (prompts: AgentPrompt[]) => prompts.find((prompt) => prompt.kind === "exam-unwritten")?.say;

function tested(html: string): string[] {
  return [...html.matchAll(/<tome-exam-question\b[^>]*\btests="([^"]+)"/g)].flatMap((match) => match[1]!.split(" "));
}

function questions(html: string): number {
  return [...html.matchAll(/<tome-exam-question\b/g)].length;
}

describe("skill/skills/teach/WRITING-ASSESSMENTS.md", () => {
  it("is pointed to from the session's step 4", () => {
    const step4 = SKILL.slice(SKILL.indexOf("### 4."), SKILL.indexOf("### 5."));
    expect(step4).toContain("(./WRITING-ASSESSMENTS.md)");
  });

  it("lists the app's defaults", () => {
    for (const [key, value] of Object.entries(DEFAULT_ASSESSMENTS)) {
      if (key === "scoreDisplay") continue;
      const shown = typeof value === "object" ? JSON.stringify(value).replace(/[{]/, "{ ").replace(/[}]$/, " }").replace(":", ": ") : String(value);
      expect(GUIDE, key).toContain(`| \`${key}\` | \`${shown}\` |`);
    }
  });
});

describe("teach scenario: lesson session writes its quiz", () => {
  let session: Scenario;
  let quiz: string;
  let unlocked: Map<string, string>;

  beforeAll(async () => {
    session = await startScenario({ upstream: [lessonsCompleted()] });
    await nextLesson(session);
    quiz = readFileSync(join(session.home, SUBJECT, "quizzes/k-to-a.html"), "utf8");
    unlocked = new Map();
    for (const file of await session.list(`${SUBJECT}/items`)) {
      for (const item of JSON.parse(await session.read(`${SUBJECT}/items/${file}`))) unlocked.set(`item:${item.id}`, item.unlockedBy);
    }
  });

  it("writes the quiz alongside the lesson it follows", () => {
    expect(written(session.actions)).toEqual([`${SUBJECT}/lessons/0005-a.html`, `${SUBJECT}/items/0005-a.json`, `${SUBJECT}/quizzes/k-to-a.html`]);
    expect(quiz).toContain(`<meta name="tome-after" content="lesson:0005-a">`);
  });

  it("builds the quiz from exam questions holding quiz widgets", () => {
    const page = readPage(quiz);
    expect(page.unknownTags).toEqual([]);
    expect(new Set(page.widgets)).toEqual(new Set(["tome-exam-question", "tome-choice", "tome-typed", "tome-done"]));
    expect(page.widgets.at(-1)).toBe("tome-done");
  });

  it("tests the lesson's items and earlier ones by ref", () => {
    const refs = tested(quiz);
    expect(refs).toContain("item:letter-a");
    for (const ref of refs) expect(unlocked.has(ref), ref).toBe(true);
  });

  it("leaves room for a miss at the subject's pass mark", () => {
    expect(Math.floor((questions(quiz) * (100 - DEFAULT_ASSESSMENTS.passMark)) / 100)).toBeGreaterThanOrEqual(1);
  });

  it("validates, then commits lesson and quiz together and pushes", async () => {
    expect(position(session.actions, "tome validate")).toBeLessThan(position(session.actions, "git commit"));
    expect(await git(session.home, ["log", "-1", "--format=%s"])).toBe("feat(morse-code): add lesson 5 (A, the short pair) and its quiz");
    expect(await git(session.home, ["show", "--name-only", "--format=", "HEAD"])).toContain("quizzes/k-to-a.html");
    expect(await git(session.remote, ["rev-parse", "main"])).toBe(await git(session.home, ["rev-parse", "HEAD"]));
  });

  it("fills the slot that opens once the learner completes the lesson", async () => {
    await appendFile(join(session.home, SUBJECT, "events/2026-11.jsonl"), completed("0005-a", "2026-11-22T19:00:00.000Z"));
    const home = await loadLearningHome(session.home);
    const subject = await loadSubject(home, "morse-code");
    const slots = quizSlots(subject, await readEvents(home, "morse-code"), new Date("2026-11-23T12:00:00.000Z"));
    expect(slots.at(-1)).toMatchObject({ after: "lesson:0005-a", quiz: "k-to-a" });
    expect((await appPrompts(session.home)).map((prompt) => prompt.kind)).not.toContain("quiz-unwritten");
  });
});

describe("teach scenario: ready milestone gets an exam", () => {
  let session: Scenario;
  let request: string | undefined;
  let exam: string;

  beforeAll(async () => {
    session = await startScenario({ upstream: [examUnwritten(), lessonsCompleted()] });
    await git(session.home, ["pull", "--quiet"]);
    request = examRequest(await appPrompts(session.home));
    await prepareExam(session, request);
    exam = readFileSync(join(session.home, EXAM), "utf8");
  });

  it("is asked for by the app once every lesson of the milestone is completed", () => {
    expect(request).toBe("Prepare the exam for “Copy K, M, R, S and U”.");
  });

  it("writes the exam the milestone names, from exam questions only", () => {
    expect(written(session.actions)).toEqual([EXAM]);
    const page = readPage(exam);
    expect(page.unknownTags).toEqual([]);
    expect(page.widgets.filter((tag) => !["tome-choice", "tome-typed"].includes(tag))).toEqual([
      ...Array(questions(exam)).fill("tome-exam-question"),
      "tome-done",
    ]);
  });

  it("tests every item the milestone's lessons unlock", async () => {
    const curriculum = JSON.parse(await session.read(`${SUBJECT}/curriculum.json`));
    const lessons: string[] = curriculum.units[0].milestones[0].lessons;
    const items = lessons.flatMap((lesson) => JSON.parse(readFileSync(join(session.home, SUBJECT, "items", `${lesson}.json`), "utf8")));
    expect(new Set(tested(exam))).toEqual(new Set(items.map((item: any) => `item:${item.id}`)));
  });

  it("validates, commits and pushes, and the app then offers the exam", async () => {
    expect(position(session.actions, "tome validate")).toBeLessThan(position(session.actions, "git commit"));
    expect(await git(session.home, ["log", "-1", "--format=%s"])).toBe("feat(morse-code): add exam for first-five");
    expect(await git(session.remote, ["rev-parse", "main"])).toBe(await git(session.home, ["rev-parse", "HEAD"]));
    expect((await appPrompts(session.home)).map((prompt) => prompt.kind)).toContain("exam-ready");
  });
});

const CASES: { name: string; assessments: Partial<Settings>; quiz: boolean; exam: boolean }[] = [
  { name: "assessments off", assessments: { enabled: false }, quiz: false, exam: false },
  { name: "exams off", assessments: { exams: false }, quiz: true, exam: false },
  { name: "quizzes on demand", assessments: { quizFrequency: "onDemand" }, quiz: false, exam: true },
];

describe.each(CASES)("teach scenario: $name", ({ assessments, quiz, exam }) => {
  let session: Scenario;

  beforeAll(async () => {
    session = await startScenario({ upstream: [examUnwritten(), lessonsCompleted(), settingsChanged(assessments)] });
    await nextLesson(session);
    await prepareExam(session, examRequest(await appPrompts(session.home)));
  });

  it(`${quiz ? "writes" : "writes no"} quiz with the lesson`, () => {
    expect(written(session.actions).some((path) => path.includes("/quizzes/"))).toBe(quiz);
  });

  it(`${exam ? "writes" : "writes no"} exam for the ready milestone`, () => {
    expect(written(session.actions).some((path) => path.includes("/exams/"))).toBe(exam);
  });

  it("leaves a valid, pushed learning home", async () => {
    expect((await session.tome("validate")).code).toBe(0);
    expect(await git(session.remote, ["rev-parse", "main"])).toBe(await git(session.home, ["rev-parse", "HEAD"]));
    expect(await git(session.home, ["status", "--porcelain"])).toBe("");
  });
});
