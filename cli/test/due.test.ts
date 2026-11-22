import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { copyExample, writeFiles } from "../../core/test/helpers.ts";
import { run } from "../src/main.ts";

async function tome(args: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, {
    cwd,
    env: { HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")) },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

async function withSemaphore(): Promise<string> {
  const root = await copyExample("morse");
  await writeFiles(root, {
    "subjects/semaphore/subject.json": { name: "Semaphore" },
    "subjects/semaphore/items/basics.json": [{ id: "letter-a", type: "flashcard", front: "A?", back: "Down-left" }],
  });
  return root;
}

async function setTimezone(root: string, timezone: string): Promise<void> {
  const config = JSON.parse(await readFile(join(root, "tomewise.json"), "utf8"));
  await writeFile(join(root, "tomewise.json"), JSON.stringify({ ...config, timezone }));
}

describe("tome due", () => {
  it("groups every subject's due items with counts", async () => {
    const root = await withSemaphore();

    const result = await tome(["due", "--date", "2026-11-20"], root);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "Due on 2026-11-20: 4 items",
        "",
        "morse-code (3)",
        "  letter-m  due 2026-11-10",
        "  letter-r  due 2026-11-11",
        "  letter-k  due 2026-11-13",
        "",
        "semaphore (1)",
        "  letter-a  new",
      ].join("\n"),
    );
  });

  it("limits to one subject", async () => {
    const root = await withSemaphore();

    const result = await tome(["due", "morse-code", "--date", "2026-11-10"], root);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(["Due on 2026-11-10: 1 item", "", "morse-code (1)", "  letter-m  due 2026-11-10"].join("\n"));
  });

  it("says when nothing is due", async () => {
    const result = await tome(["due", "morse-code", "--date", "2026-11-05"], await copyExample("morse"));

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Nothing due on 2026-11-05");
  });

  it("rejects an unknown subject, naming the ones there are", async () => {
    const result = await tome(["due", "klingon", "--date", "2026-11-20"], await copyExample("morse"));

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/No subject "klingon".*Subjects: morse-code/);
  });

  it("rejects a date that isn't a real YYYY-MM-DD day", async () => {
    const root = await copyExample("morse");

    for (const date of ["20/11/2026", "2026-02-30", "tomorrow"]) {
      const result = await tome(["due", "--date", date], root);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(`--date must be a day as YYYY-MM-DD, not "${date}"`);
    }
  });

  it("rejects unknown options and extra arguments", async () => {
    const root = await copyExample("morse");

    expect((await tome(["due", "--soon"], root)).code).toBe(2);
    expect((await tome(["due", "morse-code", "semaphore"], root)).code).toBe(2);
  });

  it("reads --date in the learning home's timezone", async () => {
    const root = await copyExample("morse");
    await setTimezone(root, "Asia/Tokyo");

    const result = await tome(["due", "--date", "2026-11-10", "--json"], root);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ date: "2026-11-10", timezone: "Asia/Tokyo", items: [] });
    const next = JSON.parse((await tome(["due", "--date", "2026-11-11", "--json"], root)).stdout);
    expect(next.items.map((due: { item: { id: string } }) => due.item.id)).toEqual(["letter-m", "letter-r"]);
  });

  it("defaults to today in the learning home's timezone", async () => {
    const root = await copyExample("morse");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

    const result = await tome(["due", "--json"], root);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).date).toBe(today);
  });

  it("prints the due list as JSON", async () => {
    const root = await withSemaphore();

    const result = await tome(["due", "--date", "2026-11-20", "--json"], root);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      date: "2026-11-20",
      timezone: "Europe/London",
      items: [
        {
          subject: "morse-code",
          due: "2026-11-10T21:10:02.030Z",
          item: {
            id: "letter-m",
            type: "timed-audio",
            audio: "assets/audio/m.wav",
            answer: "M",
            timeLimitSeconds: 5,
            unlockedBy: "0001-k-and-m",
            tags: ["letter"],
            retired: false,
          },
        },
        { subject: "morse-code", due: "2026-11-11T11:29:33.274Z", item: expect.objectContaining({ id: "letter-r" }) },
        { subject: "morse-code", due: "2026-11-13T12:52:31.678Z", item: expect.objectContaining({ id: "letter-k" }) },
        {
          subject: "semaphore",
          due: null,
          item: { id: "letter-a", type: "flashcard", front: "A?", back: "Down-left", tags: [], retired: false },
        },
      ],
    });
  });

  it("runs as a real process", async () => {
    const root = await copyExample("morse");
    const main = new URL("../src/main.ts", import.meta.url).pathname;

    const { stdout } = await promisify(execFile)(process.execPath, [main, "due", "morse-code", "--date", "2026-11-10"], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: await mkdtemp(join(tmpdir(), "tomewise-cli-home-")) },
    });

    expect(stdout).toContain("letter-m  due 2026-11-10");
  });
});
