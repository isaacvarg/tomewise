import { appendFile, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/main.ts";

async function morse(config: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tomewise-cli-"));
  await cp(new URL("../../examples/morse/", import.meta.url), root, { recursive: true });
  const file = join(root, "tomewise.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), ...config }));
  return root;
}

async function tome(args: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const env = { HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")) };
  const code = await run(args, { cwd, env, stdout: (line) => out.push(line), stderr: (line) => err.push(line) });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

async function stats(args: string[], cwd: string) {
  const result = await tome(["stats", ...args, "--json"], cwd);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout);
}

describe("tome stats", () => {
  it("summarises every subject up to the given day as JSON", async () => {
    const root = await morse();

    expect(await stats(["--to", "2026-11-21"], root)).toEqual({
      subjects: ["morse-code"],
      from: null,
      to: "2026-11-21",
      timezone: "Europe/London",
      sessions: 4,
      durationMs: 60440,
      attempts: { total: 23, correct: 20, wrong: 3, skipped: 0 },
      accuracy: 20 / 23,
      activityDays: 0,
      streak: { days: 0, restDaysLeft: 0 },
    });
  });

  it("counts activity days and the streak by core's rules: minimum session length and rest days", async () => {
    const root = await morse({ minimumSessionSeconds: 10, streak: { restDaysPerWeek: 2 } });

    const result = await stats(["--to", "2026-11-05"], root);

    expect(result.activityDays).toBe(3);
    expect(result.streak).toEqual({ days: 3, restDaysLeft: 0 });
    expect((await stats(["--to", "2026-11-09"], root)).activityDays).toBe(3);
  });

  it("narrows to a range of days, inclusive at both ends", async () => {
    const root = await morse({ minimumSessionSeconds: 10 });

    const result = await stats(["--from", "2026-11-02", "--to", "2026-11-05"], root);

    expect(result).toMatchObject({
      from: "2026-11-02",
      to: "2026-11-05",
      sessions: 2,
      durationMs: 17770 + 18360,
      attempts: { total: 14, correct: 12, wrong: 2, skipped: 0 },
      activityDays: 2,
    });
  });

  it("reads days in the learning home's timezone", async () => {
    const day = ["--from", "2026-11-09", "--to", "2026-11-09"];

    expect((await stats(day, await morse())).sessions).toBe(0);
    expect((await stats(day, await morse({ timezone: "Pacific/Auckland" }))).sessions).toBe(1);
  });

  it("narrows to one subject when given one", async () => {
    const root = await morse({ minimumSessionSeconds: 0 });
    const yoga = join(root, "subjects", "yoga");
    await mkdir(join(yoga, "events"), { recursive: true });
    await writeFile(join(yoga, "subject.json"), JSON.stringify({ name: "Yoga" }));
    const base = { subject: "yoga", ref: "drill:sun", sessionId: "01KAJ00000000000000000000Y", schemaVersion: 1 };
    await writeFile(
      join(yoga, "events", "2026-11.jsonl"),
      [
        { id: "01KAJ00000000000000000000Y", ts: "2026-11-20T08:00:00.000Z", kind: "session.start", ...base },
        { id: "01KAJ00000000000000000000Z", ts: "2026-11-20T08:20:00.000Z", kind: "session.end", duration: 1_200_000, ...base },
      ]
        .map((event) => `${JSON.stringify(event)}\n`)
        .join(""),
    );

    const all = await stats(["--to", "2026-11-21"], root);
    const one = await stats(["morse-code", "--to", "2026-11-21"], root);

    expect(all).toMatchObject({ subjects: ["morse-code", "yoga"], sessions: 5, activityDays: 5 });
    expect(one).toMatchObject({ subjects: ["morse-code"], sessions: 4, durationMs: 60440, activityDays: 4 });
  });

  it("counts skipped attempts apart and against accuracy", async () => {
    const root = await morse();
    await appendFile(
      join(root, "subjects", "morse-code", "events", "2026-11.laptop.jsonl"),
      `${JSON.stringify({
        id: "01M6YFYF1J25NTFK7GD2WT34MA",
        ts: "2026-11-08T21:10:06.500Z",
        subject: "morse-code",
        kind: "attempt",
        ref: "item:letter-k",
        sessionId: "01M6YFY920Y53N456NMZNRR6JM",
        outcome: "skipped",
        grade: 1,
        schemaVersion: 2,
        data: { heard: "k", answer: "", responseTime: 0, wpm: 12 },
      })}\n`,
    );

    const result = await stats(["--to", "2026-11-21"], root);

    expect(result.attempts).toEqual({ total: 24, correct: 20, wrong: 3, skipped: 1 });
    expect(result.accuracy).toBe(20 / 24);
  });

  it("reports no accuracy when there are no attempts", async () => {
    const result = await stats(["--from", "2026-11-20", "--to", "2026-11-21"], await morse());

    expect(result).toMatchObject({ sessions: 0, durationMs: 0, attempts: { total: 0 }, accuracy: null });
  });

  it("prints a readable summary by default", async () => {
    const result = await tome(["stats", "--to", "2026-11-21"], await morse({ minimumSessionSeconds: 10 }));

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "All subjects, up to 2026-11-21 (Europe/London)",
        "Sessions       4",
        "Time           1m 0s",
        "Attempts       23: 20 correct, 3 wrong, 0 skipped",
        "Accuracy       87%",
        "Activity days  3",
        "Streak         0 days",
      ].join("\n"),
    );
  });

  it("names the subject and range in the readable summary", async () => {
    const result = await tome(
      ["stats", "morse-code", "--from", "2026-11-01", "--to", "2026-11-02"],
      await morse({ minimumSessionSeconds: 10, streak: { restDaysPerWeek: 2 } }),
    );

    expect(result.stdout.split("\n")[0]).toBe("morse-code, 2026-11-01 to 2026-11-02 (Europe/London)");
    expect(result.stdout).toContain("Time           18s");
    expect(result.stdout).toContain("Streak         2 days, 2 rest days left this week");
  });

  it("refuses a subject that doesn't exist, listing the ones that do", async () => {
    const result = await tome(["stats", "knitting"], await morse());

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('No subject "knitting"');
    expect(result.stderr).toContain("morse-code");
  });

  it("refuses a date that isn't YYYY-MM-DD", async () => {
    const result = await tome(["stats", "--from", "21/11/2026"], await morse());

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("YYYY-MM-DD");
  });

  it("refuses a range that ends before it starts", async () => {
    const result = await tome(["stats", "--from", "2026-11-05", "--to", "2026-11-02"], await morse());

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("after it ends");
  });
});
