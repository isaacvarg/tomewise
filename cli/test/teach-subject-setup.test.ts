import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLearningHome, loadSubject } from "../../core/src/load.ts";
import { commandLine, firstWrite, git, position, startScenario, written, type Scenario } from "./scenario.ts";

const SKILL = readFileSync(new URL("../../skill/skills/teach/SKILL.md", import.meta.url), "utf8");
const SETUP = readFileSync(new URL("../../skill/skills/teach/SUBJECT-SETUP.md", import.meta.url), "utf8");
const [NEW_SUBJECT, CURRICULUM_CHANGE] = SETUP.split("## Changing the curriculum");
const SETUP_ORDER = ["git pull", "tome validate", "git add", "git commit", "git push"];

const TYPING = "subjects/touch-typing";
const MORSE = "subjects/morse-code";

const ANSWERS = {
  enabled: true,
  quizFrequency: "weekly",
  quizLength: 8,
  exams: true,
  timed: false,
  scoreDisplay: "pass-fail",
  passMark: 85,
} as const;

const MISSION = `# Mission: Touch typing

## Why
Write up meeting notes live without looking at the keyboard, so I can keep eye contact.

## Success looks like
- Type 60 words per minute at 97% accuracy

## Constraints
- Ten minutes a day

## Out of scope
- Stenography
`;

const CURRICULUM = {
  units: [
    {
      title: "Home row",
      milestones: [
        { id: "home-row", title: "Type the home row without looking", status: "current" },
        { id: "top-row", title: "Reach the top row from home", status: "upcoming" },
      ],
    },
  ],
};

function inOrder(actions: Scenario["actions"], order: readonly string[]): boolean {
  const commands = actions.filter((action) => action.type === "git" || action.type === "tome").map(commandLine);
  const at = order.map((prefix) => commands.findIndex((command) => command.startsWith(prefix)));
  return at.every((index) => index > -1) && at.every((index, i) => i === 0 || index > at[i - 1]!);
}

async function setUpSubject(session: Scenario, answers: Record<string, unknown>) {
  await session.git("pull", "--quiet");
  expect(await session.list("subjects")).not.toContain("touch-typing");

  const home = JSON.parse(await session.read("tomewise.json"));
  const homeAssessments = (await loadLearningHome(session.home)).config.assessments as Record<string, unknown>;
  expect(home.assessments).toBeUndefined();

  await session.write(`${TYPING}/MISSION.md`, MISSION);

  const assessments = Object.fromEntries(
    Object.entries(answers).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(homeAssessments[key])),
  );
  const subject = {
    name: "Touch typing",
    payloadSchemas: [
      {
        version: 1,
        kinds: {
          attempt: {
            type: "object",
            properties: {
              typed: { type: "string" },
              wpm: { type: "number", unit: "wpm" },
              responseTime: { type: "integer", unit: "ms" },
            },
          },
        },
      },
    ],
    settings: { assessments },
  };
  await session.write(`${TYPING}/subject.json`, JSON.stringify(subject, null, 2) + "\n");
  await session.write(`${TYPING}/curriculum.json`, JSON.stringify(CURRICULUM, null, 2) + "\n");

  const validate = await session.tome("validate");
  expect(validate.stderr).toBe("");

  await session.git("add", TYPING);
  await session.git("commit", "--message", "feat(touch-typing): start subject");
  await session.git("push", "--quiet");
  return { subject, homeAssessments };
}

const ADD_WORDS = {
  id: "first-words",
  title: "Copy CQ, DE and the learner's callsign",
  status: "upcoming",
};

const RECORD = `# Curriculum: first words before more letters

The learner wants to call CQ on air soon, so copying CQ, DE and their own callsign now matters more than the next five letters. Added the first-words milestone after first-five.
`;

async function proposeFirstWords(session: Scenario, learnerSays: "yes" | "no") {
  await session.git("pull", "--quiet");
  const curriculum = JSON.parse(await session.read(`${MORSE}/curriculum.json`));
  const records = await session.list(MORSE).then((files) => files.includes("learning-records"));
  expect(records).toBe(false);

  const answeredAt = session.actions.length;
  if (learnerSays === "no") {
    await session.write(`${MORSE}/NOTES.md`, "- Declined a first-words milestone before more letters (2026-11-23).\n");
    await session.git("add", MORSE);
    await session.git("commit", "--message", "chore(morse-code): note declined curriculum change");
    await session.git("push", "--quiet");
    return answeredAt;
  }

  curriculum.units[0].milestones.splice(1, 0, ADD_WORDS);
  await session.write(`${MORSE}/curriculum.json`, JSON.stringify(curriculum, null, 2) + "\n");
  await session.write(`${MORSE}/learning-records/0001-first-words-before-more-letters.md`, RECORD);

  const validate = await session.tome("validate");
  expect(validate.stderr).toBe("");

  await session.git("add", MORSE);
  await session.git("commit", "--message", "chore(morse-code): update curriculum, first words before more letters");
  await session.git("push", "--quiet");
  return answeredAt;
}

describe("skill/skills/teach/SUBJECT-SETUP.md", () => {
  it("is reached from SKILL.md", () => {
    expect(SKILL).toContain("[SUBJECT-SETUP.md](./SUBJECT-SETUP.md)");
  });

  it("lists the setup commands in the order the scenario runs them", () => {
    const at = SETUP_ORDER.map((command) => NEW_SUBJECT!.indexOf(command));
    expect(at.every((index) => index > -1), SETUP_ORDER.filter((_, i) => at[i] === -1).join(", ")).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("covers mission, payload schema, every assessment setting and both files", () => {
    for (const text of ["MISSION.md", "payload schema", "subject.json", "curriculum.json", "settings.assessments"]) {
      expect(NEW_SUBJECT, text).toContain(text);
    }
    for (const key of Object.keys(ANSWERS)) expect(NEW_SUBJECT, key).toContain(`\`${key}\``);
  });

  it("has curriculum changes proposed, confirmed, then recorded", () => {
    const steps = ["**Propose.**", "**Wait for a yes.**", "**Write both.**"].map((step) => CURRICULUM_CHANGE!.indexOf(step));
    expect(steps.every((index) => index > -1)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(CURRICULUM_CHANGE).toContain("learning record");
  });
});

describe("subject setup scenario: start touch typing", () => {
  let session: Scenario;
  let homeAssessments: Record<string, unknown>;

  beforeAll(async () => {
    session = await startScenario({ example: "morse" });
    ({ homeAssessments } = await setUpSubject(session, ANSWERS));
  });

  it("follows the setup's command order", () => {
    expect(inOrder(session.actions, SETUP_ORDER)).toBe(true);
  });

  it("pulls before writing any file", () => {
    expect(position(session.actions, "git pull")).toBeLessThan(firstWrite(session.actions));
  });

  it("writes the mission, subject.json and curriculum.json", () => {
    expect(written(session.actions)).toEqual([`${TYPING}/MISSION.md`, `${TYPING}/subject.json`, `${TYPING}/curriculum.json`]);
  });

  it("passes tome validate", () => {
    const validate = session.actions.find((action) => action.type === "tome" && action.args[0] === "validate");
    expect(validate?.type === "tome" && validate.code).toBe(0);
    expect(position(session.actions, "tome validate")).toBeGreaterThan(session.actions.findLastIndex((action) => action.type === "write"));
  });

  it("gives the subject the assessment settings the learner chose", async () => {
    const subject = await loadSubject(await loadLearningHome(session.home), "touch-typing");
    expect(subject.settings.assessments).toMatchObject(ANSWERS);
  });

  it("stores only the answers that differ from the home", () => {
    const file = JSON.parse(readFileSync(`${session.home}/${TYPING}/subject.json`, "utf8"));
    const stored = Object.keys(file.settings.assessments);
    expect(stored.length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(ANSWERS)) {
      expect(stored.includes(key), key).toBe(JSON.stringify(value) !== JSON.stringify(homeAssessments[key]));
    }
  });

  it("keeps attempt fields optional while assessments are on", () => {
    const file = JSON.parse(readFileSync(`${session.home}/${TYPING}/subject.json`, "utf8"));
    expect(file.payloadSchemas).toHaveLength(1);
    expect(file.payloadSchemas[0].kinds.attempt.required).toBeUndefined();
  });

  it("starts the curriculum at its first milestone", () => {
    const file = JSON.parse(readFileSync(`${session.home}/${TYPING}/curriculum.json`, "utf8"));
    const statuses = file.units.flatMap((unit: any) => unit.milestones.map((milestone: any) => milestone.status));
    expect(statuses).toEqual(["current", "upcoming"]);
  });

  it("commits in the learning home's style and pushes", async () => {
    expect(await git(session.home, ["log", "-1", "--format=%B"])).toBe("feat(touch-typing): start subject");
    expect(await git(session.remote, ["rev-parse", "main"])).toBe(await git(session.home, ["rev-parse", "HEAD"]));
    expect(await git(session.home, ["status", "--porcelain"])).toBe("");
  });

  it("matches whatever the learner answers", async () => {
    const other = await startScenario({ example: "morse" });
    const answers = { ...ANSWERS, enabled: false, quizFrequency: { every: 3 }, timed: { minutes: 15 }, passMark: 60 };
    await setUpSubject(other, answers);
    const subject = await loadSubject(await loadLearningHome(other.home), "touch-typing");
    expect(subject.settings.assessments).toMatchObject(answers);
  });
});

describe("curriculum change scenario", () => {
  it("leaves curriculum.json alone when the learner declines", async () => {
    const session = await startScenario({ example: "morse" });
    const before = readFileSync(`${session.home}/${MORSE}/curriculum.json`, "utf8");
    const answeredAt = await proposeFirstWords(session, "no");

    const after = session.actions.slice(answeredAt);
    expect(written(after)).toEqual([`${MORSE}/NOTES.md`]);
    expect(readFileSync(`${session.home}/${MORSE}/curriculum.json`, "utf8")).toBe(before);
    expect(await git(session.home, ["log", "-1", "--name-only", "--format="])).not.toContain("curriculum.json");
  });

  it("writes the change only after a yes, with a learning record in the same commit", async () => {
    const session = await startScenario({ example: "morse" });
    const answeredAt = await proposeFirstWords(session, "yes");

    expect(written(session.actions.slice(0, answeredAt))).toEqual([]);
    expect(written(session.actions)).toEqual([
      `${MORSE}/curriculum.json`,
      `${MORSE}/learning-records/0001-first-words-before-more-letters.md`,
    ]);

    const files = (await git(session.home, ["log", "-1", "--name-only", "--format="])).split("\n");
    expect(files.sort()).toEqual([`${MORSE}/curriculum.json`, `${MORSE}/learning-records/0001-first-words-before-more-letters.md`]);
    expect(await git(session.home, ["log", "-1", "--format=%B"])).toMatch(/^chore\(morse-code\): update curriculum, /);

    const validate = session.actions.find((action) => action.type === "tome" && action.args[0] === "validate");
    expect(validate?.type === "tome" && validate.code).toBe(0);
    expect(await git(session.remote, ["rev-parse", "main"])).toBe(await git(session.home, ["rev-parse", "HEAD"]));
  });
});
