import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { position, startScenario, written, type Scenario, type Upstream } from "./scenario.ts";

const TEACH = new URL("../../skill/skills/teach/", import.meta.url);
const SKILL = readFileSync(new URL("SKILL.md", TEACH), "utf8");
const GRADING = readFileSync(new URL("GRADING.md", TEACH), "utf8");
const SUBJECT = "subjects/morse-code";
const EXAMPLE_LOG = /^tome log '(.+)'$/m.exec(GRADING)?.[1];

const SAVED = {
  id: "01KAP0000000000000000000X1",
  ts: "2026-11-22T19:05:00.000Z",
  subject: "morse-code",
  kind: "explanation.saved",
  ref: "lesson:0004-the-late-bump",
  schemaVersion: 3,
  data: { text: "U is S with a dah added at the start." },
};

const FEEDBACK =
  "Close. U is dit-dit-dah: it starts like S, then ends on a dah. The long sound comes last, which is the late bump.";

function explanationSavedOnPhone(): Upstream {
  return {
    message: "chore(history): 2026-11-22 · morse-code 1 explanation",
    append: { [`${SUBJECT}/events/2026-11.jsonl`]: `${JSON.stringify(SAVED)}\n` },
  };
}

interface Explanation {
  id: string;
  ref: string;
  text: string;
}

async function events(session: Scenario): Promise<any[]> {
  const files = (await session.list(`${SUBJECT}/events`)).filter((file) => file.endsWith(".jsonl"));
  const lines = await Promise.all(files.map((file) => session.read(`${SUBJECT}/events/${file}`)));
  return lines.flatMap((text) => text.split("\n").filter(Boolean)).map((line) => JSON.parse(line));
}

async function ungradedExplanations(session: Scenario): Promise<Explanation[]> {
  const all = await events(session);
  const graded = new Set(all.filter((event) => event.kind === "explanation.graded").map((event) => event.ref));
  return all
    .filter((event) => event.kind === "explanation.saved" && !graded.has(`event:${event.id}`))
    .map((event) => ({ id: event.id, ref: event.ref, text: event.data.text }));
}

async function gradeBeforePlanning(session: Scenario) {
  await session.git("pull", "--quiet");
  await session.tome("stats", "--json");
  await session.tome("due", "--json");

  const ungraded = await ungradedExplanations(session);
  for (const explanation of ungraded) {
    await session.read(`${SUBJECT}/lessons/${explanation.ref.slice("lesson:".length)}.html`);
    const logged = await session.tome(
      "log",
      JSON.stringify({
        subject: "morse-code",
        kind: "explanation.graded",
        ref: `event:${explanation.id}`,
        schemaVersion: 3,
        data: { feedback: FEEDBACK },
      }),
    );
    expect(logged.code, logged.stderr).toBe(0);
  }

  const validate = await session.tome("validate");
  expect(validate.stderr).toBe("");
  await session.git("add", SUBJECT);
  await session.git("commit", "--message", "chore(morse-code): grade explanation");
  await session.git("push", "--quiet");
  return ungraded;
}

describe("skill/skills/teach/GRADING.md", () => {
  it("is linked from step 1 of SKILL.md", () => {
    const step1 = SKILL.slice(SKILL.indexOf("### 1. Before planning"), SKILL.indexOf("### 2."));
    expect(step1).toContain("[GRADING.md](./GRADING.md)");
  });

  it("points at EVENTS-FORMAT.md for the event format", () => {
    expect(GRADING).toContain("[EVENTS-FORMAT.md](./EVENTS-FORMAT.md)");
  });

  it("shows a tome log call that passes tome validate against the Morse example", async () => {
    expect(EXAMPLE_LOG).toBeDefined();
    const example = JSON.parse(EXAMPLE_LOG!);
    expect(example).toMatchObject({ kind: "explanation.graded", ref: expect.stringMatching(/^event:/) });
    expect(example.data.feedback).toMatch(/^(Right|Close|Not yet)\. /);

    const session = await startScenario({ example: "morse" });
    const saved = (await events(session)).find((event) => `event:${event.id}` === example.ref);
    expect(saved?.kind).toBe("explanation.saved");

    const logged = await session.tome("log", EXAMPLE_LOG!);
    expect(logged.code, logged.stderr).toBe(0);
    const validate = await session.tome("validate");
    expect(validate.code, validate.stderr).toBe(0);
  });
});

describe("teach scenario: an explanation waiting to be graded", () => {
  let session: Scenario;
  let ungraded: Explanation[];

  beforeAll(async () => {
    session = await startScenario({ example: "morse", upstream: [explanationSavedOnPhone()] });
    ungraded = await gradeBeforePlanning(session);
  });

  it("finds only the explanation no grade points at", () => {
    expect(ungraded).toEqual([{ id: SAVED.id, ref: SAVED.ref, text: SAVED.data.text }]);
  });

  it("grades after pulling history, before planning", () => {
    const log = position(session.actions, "tome log");
    expect(log).toBeGreaterThan(position(session.actions, "git pull"));
    expect(log).toBeGreaterThan(position(session.actions, "tome due --json"));
    expect(log).toBeLessThan(position(session.actions, "tome validate"));
  });

  it("ends with a valid explanation.graded referencing it", async () => {
    const grades = (await events(session)).filter((event) => event.kind === "explanation.graded" && event.ref === `event:${SAVED.id}`);
    expect(grades).toHaveLength(1);
    expect(grades[0].data.feedback).toBe(FEEDBACK);
    const validate = await session.tome("validate");
    expect(validate.code, validate.stderr).toBe(0);
    expect(await ungradedExplanations(session)).toEqual([]);
  });

  it("logs only through the CLI", () => {
    expect(written(session.actions)).toEqual([]);
  });
});
