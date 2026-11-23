import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ASSESSMENTS } from "@tomewise/core";
import { startTestApp } from "./harness.ts";

const MORSE_CONFIG = `{
  "formatVersion": 1,
  "timezone": "Europe/London",
  "weekStart": "monday",
  "minimumSessionSeconds": 60
}
`;

async function appWith(config?: string, subjects: string[] = []) {
  const app = await startTestApp(async (root) => {
    if (config !== undefined) await writeFile(join(root, "tomewise.json"), config);
    for (const id of subjects) {
      await mkdir(join(root, "subjects", id), { recursive: true });
      await writeFile(join(root, "subjects", id, "subject.json"), JSON.stringify({ name: id[0]!.toUpperCase() + id.slice(1) }));
    }
  });
  const file = () => readFile(join(app.root, "tomewise.json"), "utf8");
  const subjectFile = (id: string) => readFile(join(app.root, "subjects", id, "subject.json"), "utf8");
  async function put(key: string, body: unknown) {
    const response = await fetch(`${app.url}/api/settings/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  return { ...app, file, subjectFile, put };
}

describe("GET /api/settings", () => {
  it("gives the three settings the app writes, with defaults, and the themes to pick from", async () => {
    const app = await appWith();

    const response = await app.get("/api/settings");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      theme: "paper",
      start: "sequence",
      subjects: [],
      assessments: DEFAULT_ASSESSMENTS,
      subjectAssessments: { "morse-code": {} },
      themes: [
        { name: "meadow", label: "Meadow", description: expect.any(String), stylesheets: ["tokens.css", "theme.css"], script: "leaves.js" },
        { name: "paper", label: "Paper", description: expect.any(String), stylesheets: ["tokens.css", "theme.css"] },
      ],
    });
  });

  it("lists the learning home's own themes beside the built-in ones", async () => {
    const app = await startTestApp(async (root) => {
      await mkdir(join(root, "themes", "dusk"), { recursive: true });
      await writeFile(join(root, "themes", "dusk", "tokens.css"), ":root {}");
    });

    const response = await app.get("/api/settings");

    expect(response.body.themes.map((theme: { name: string }) => theme.name)).toEqual(["dusk", "meadow", "paper"]);
    expect(response.body.themes[0]).toEqual({ name: "dusk", label: "dusk", stylesheets: ["tokens.css"] });
  });
});

describe("PUT /api/settings/:key", () => {
  it("adds a missing key at the end of tomewise.json, keeping the rest as it was", async () => {
    const app = await appWith(MORSE_CONFIG);

    const response = await app.put("theme", { value: "meadow" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ theme: "meadow", start: "sequence", subjects: [] });
    expect(await app.file()).toBe(MORSE_CONFIG.replace('"minimumSessionSeconds": 60\n', '"minimumSessionSeconds": 60,\n  "theme": "meadow"\n'));
  });

  it("rewrites only the value of a key that's there, keeping other keys, their order and formatting", async () => {
    const before = [
      "{",
      '\t"theme" : "paper",',
      '\t"formatVersion": 1,',
      '\t"streak": { "restDaysPerWeek": 1 },',
      '\t"git": {"enabled": false, "remote": "theme"},',
      '\t"weekStart":"sunday"',
      "}",
    ].join("\n");
    const app = await appWith(before);

    await app.put("theme", { value: "meadow" });

    expect(await app.file()).toBe(before.replace('"theme" : "paper"', '"theme" : "meadow"'));
  });

  it("adds a key to a one-line file on the same line", async () => {
    const app = await appWith('{ "formatVersion": 1 }');

    await app.put("start", { value: "ask" });

    expect(await app.file()).toBe('{ "formatVersion": 1, "start": "ask" }');
  });

  it("saves the Start mode", async () => {
    const app = await appWith(`{\n  "formatVersion": 1,\n  "start": "ask"\n}\n`);

    const response = await app.put("start", { value: "sequence" });

    expect(response.body.start).toBe("sequence");
    expect(await app.file()).toBe(`{\n  "formatVersion": 1,\n  "start": "sequence"\n}\n`);
  });

  it("saves the subject order as a one-line list", async () => {
    const before = `{\n  "formatVersion": 1,\n  "subjects": [\n    "morse-code"\n  ],\n  "theme": "paper"\n}\n`;
    const app = await appWith(before, ["spanish", "yoga"]);

    const response = await app.put("subjects", { value: ["yoga", "morse-code", "spanish"] });

    expect(response.body.subjects).toEqual(["yoga", "morse-code", "spanish"]);
    expect(await app.file()).toBe(`{\n  "formatVersion": 1,\n  "subjects": ["yoga", "morse-code", "spanish"],\n  "theme": "paper"\n}\n`);
  });

  it("reads back what it saved straight away", async () => {
    const app = await appWith(MORSE_CONFIG);

    await app.put("start", { value: "ask" });

    expect((await app.get("/api/settings")).body.start).toBe("ask");
  });

  it.each([
    ["theme", { value: "../paper" }, /must be a folder name/],
    ["theme", { value: "neon" }, /No theme "neon"/],
    ["start", { value: "random" }, /Use "sequence" or "ask"/],
    ["subjects", { value: "morse-code" }, /expected array/i],
    ["subjects", { value: ["chess"] }, /No subject "chess"/],
    ["subjects", { value: ["morse-code", "morse-code"] }, /already listed/],
    ["start", {}, /value/],
    ["start", "{", /Invalid JSON/],
  ])("refuses %s %j and leaves the file alone", async (key, body, message) => {
    const app = await appWith(MORSE_CONFIG);

    const response = await app.put(key, body);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(message);
    expect(await app.file()).toBe(MORSE_CONFIG);
  });

  it("refuses keys the learner sets by editing the file", async () => {
    const app = await appWith(MORSE_CONFIG);

    const response = await app.put("timezone", { value: "Pacific/Auckland" });

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/theme, start, subjects or assessments/);
    expect(await app.file()).toBe(MORSE_CONFIG);
  });

  it("refuses to save over a tomewise.json that has become invalid", async () => {
    const app = await appWith(MORSE_CONFIG);
    const broken = MORSE_CONFIG.replace('"monday"', '"funday"');
    await writeFile(join(app.root, "tomewise.json"), broken);

    const response = await app.put("start", { value: "ask" });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/weekStart/);
    expect(await app.file()).toBe(broken);
  });
});

describe("assessment settings", () => {
  const relaxed = { enabled: false };

  it("saves the home defaults to tomewise.json as one block, keeping the rest of the file", async () => {
    const app = await appWith(MORSE_CONFIG);
    const value = { ...DEFAULT_ASSESSMENTS, quizFrequency: "weekly", timed: { minutes: 20 }, passMark: 80 };

    const response = await app.put("assessments", { value });

    expect(response.status).toBe(200);
    expect(response.body.assessments).toEqual(value);
    expect(await app.file()).toBe(
      MORSE_CONFIG.replace(
        '"minimumSessionSeconds": 60\n',
        [
          '"minimumSessionSeconds": 60,',
          '  "assessments": {',
          '    "enabled": true,',
          '    "quizFrequency": "weekly",',
          '    "quizLength": 10,',
          '    "exams": true,',
          '    "timed": {',
          '      "minutes": 20',
          "    },",
          '    "scoreDisplay": "number",',
          '    "passMark": 80',
          "  }",
          "",
        ].join("\n"),
      ),
    );
    expect((await app.get("/api/subjects/morse-code")).body.settings.assessments).toEqual(value);
  });

  it("fills settings left out of the home defaults from the built-in ones", async () => {
    const app = await appWith(MORSE_CONFIG);

    const response = await app.put("assessments", { value: { passMark: 50 } });

    expect(response.body.assessments).toEqual({ ...DEFAULT_ASSESSMENTS, passMark: 50 });
  });

  it("saves a subject's overrides to its subject.json, keeping the rest of the file", async () => {
    const app = await appWith(MORSE_CONFIG, ["spanish"]);

    const response = await app.put("subjects/spanish/assessments", { value: { passMark: 90, scoreDisplay: "pass-fail" } });

    expect(response.status).toBe(200);
    expect(response.body.subjectAssessments).toEqual({ "morse-code": {}, spanish: { passMark: 90, scoreDisplay: "pass-fail" } });
    expect(await app.subjectFile("spanish")).toBe('{"name":"Spanish","settings":{ "assessments": { "scoreDisplay": "pass-fail", "passMark": 90 } }}');
  });

  it("adds the overrides inside an existing settings block of a multi-line subject.json", async () => {
    const before = '{\n  "name": "Spanish",\n  "settings": {\n    "minimumSessionSeconds": 30\n  }\n}\n';
    const app = await appWith(MORSE_CONFIG, ["spanish"]);
    await writeFile(join(app.root, "subjects", "spanish", "subject.json"), before);

    await app.put("subjects/spanish/assessments", { value: relaxed });

    expect(await app.subjectFile("spanish")).toBe(
      '{\n  "name": "Spanish",\n  "settings": {\n    "minimumSessionSeconds": 30,\n    "assessments": {\n      "enabled": false\n    }\n  }\n}\n',
    );
  });

  it("resolves each subject's settings with its overrides over the home defaults", async () => {
    const app = await appWith(MORSE_CONFIG, ["spanish", "yoga"]);
    await app.put("assessments", { value: { passMark: 80, quizFrequency: { every: 3 } } });

    await app.put("subjects/yoga/assessments", { value: relaxed });
    await app.put("subjects/spanish/assessments", { value: { passMark: 60 } });

    const yoga = (await app.get("/api/subjects/yoga")).body.settings.assessments;
    const spanish = (await app.get("/api/subjects/spanish")).body.settings.assessments;
    const morse = (await app.get("/api/subjects/morse-code")).body.settings.assessments;
    expect(yoga).toEqual({ ...DEFAULT_ASSESSMENTS, enabled: false, passMark: 80, quizFrequency: { every: 3 } });
    expect(spanish).toEqual({ ...DEFAULT_ASSESSMENTS, passMark: 60, quizFrequency: { every: 3 } });
    expect(morse).toEqual({ ...DEFAULT_ASSESSMENTS, passMark: 80, quizFrequency: { every: 3 } });
  });

  it("clears a subject's overrides, so it follows the home defaults again", async () => {
    const app = await appWith(MORSE_CONFIG, ["yoga"]);
    await app.put("subjects/yoga/assessments", { value: relaxed });

    const response = await app.put("subjects/yoga/assessments", { value: {} });

    expect(response.body.subjectAssessments.yoga).toEqual({});
    expect((await app.get("/api/subjects/yoga")).body.settings.assessments).toEqual(DEFAULT_ASSESSMENTS);
  });

  it.each([
    ["assessments", { value: { passMark: 120 } }, /assessments\.passMark/],
    ["assessments", { value: { quizFrequency: "daily" } }, /"weekly" or "onDemand"/],
    ["assessments", { value: { scoreDisplay: "letter" } }, /"pass-fail"/],
    ["assessments", { value: { timed: true } }, /"minutes"/],
    ["assessments", { value: { quizzes: true } }, /quizzes/],
  ])("refuses home defaults %s %j and leaves the file alone", async (key, body, message) => {
    const app = await appWith(MORSE_CONFIG);

    const response = await app.put(key, body);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(message);
    expect(await app.file()).toBe(MORSE_CONFIG);
  });

  it.each([
    [{ value: { passMark: -5 } }, /settings\.assessments\.passMark/],
    [{ value: { quizLength: 0 } }, /quizLength/],
    [{ value: "off" }, /object/],
    [{}, /value/],
    ["{", /Invalid JSON/],
  ])("refuses subject overrides %j and leaves subject.json alone", async (body, message) => {
    const app = await appWith(MORSE_CONFIG, ["yoga"]);
    const before = await app.subjectFile("yoga");

    const response = await app.put("subjects/yoga/assessments", body);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(message);
    expect(await app.subjectFile("yoga")).toBe(before);
  });

  it("refuses overrides for a subject that isn't there", async () => {
    const app = await appWith(MORSE_CONFIG);

    const response = await app.put("subjects/chess/assessments", { value: relaxed });

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/No subject "chess"/);
  });

  it("refuses to save over a subject.json that has become invalid", async () => {
    const app = await appWith(MORSE_CONFIG, ["yoga"]);
    const broken = '{ "name": "" }';
    await writeFile(join(app.root, "subjects", "yoga", "subject.json"), broken);

    const response = await app.put("subjects/yoga/assessments", { value: relaxed });

    expect(response.status).toBe(409);
    expect(await app.subjectFile("yoga")).toBe(broken);
  });
});
