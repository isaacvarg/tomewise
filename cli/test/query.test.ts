import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyExample } from "../../core/test/helpers.ts";
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

async function json(args: string[], cwd: string) {
  const result = await tome([...args, "--json"], cwd);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout);
}

describe("tome query", () => {
  it("aggregates a payload field over every attempt, with its unit", async () => {
    const root = await copyExample("morse");

    const result = await tome(["query", "morse-code", "--field", "responseTime", "--agg", "max"], root);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("max responseTime: 1480 ms (23 attempts)");
  });

  it("filters by ref and bounds the range by day", async () => {
    const root = await copyExample("morse");

    const result = await json(
      [
        "query",
        "morse-code",
        "--field",
        "data.responseTime",
        "--agg",
        "median",
        "--where",
        "ref=item:letter-k",
        "--from",
        "2026-11-02",
        "--to",
        "2026-11-08",
      ],
      root,
    );

    expect(result).toEqual({
      subject: "morse-code",
      kind: "attempt",
      field: "responseTime",
      agg: "median",
      unit: "ms",
      value: 535,
      count: 4,
      where: { ref: "item:letter-k" },
      from: "2026-11-02",
      to: "2026-11-08",
    });
  });

  it("filters by other envelope fields, ANDing several", async () => {
    const root = await copyExample("morse");

    const wrong = await json(["query", "morse-code", "--field", "responseTime", "--agg", "count", "--where", "outcome=wrong"], root);
    const wrongK = await json(
      ["query", "morse-code", "--field", "responseTime", "--agg", "mean", "--where", "outcome=wrong", "--where", "ref=item:letter-k"],
      root,
    );

    expect(wrong.value).toBe(3);
    expect(wrongK).toMatchObject({ value: 1340, count: 1 });
  });

  it("computes mean, median and min", async () => {
    const root = await copyExample("morse");
    const of = async (agg: string) =>
      (await json(["query", "morse-code", "--field", "responseTime", "--agg", agg, "--where", "ref=item:letter-k"], root)).value;

    expect(await of("min")).toBe(490);
    expect(await of("median")).toBe(640);
    expect(await of("mean")).toBeCloseTo(5150 / 7);
  });

  it("reads each event with its own payload schema version", async () => {
    const root = await copyExample("morse");

    const result = await json(["query", "morse-code", "--field", "wpm", "--agg", "mean"], root);

    expect(result).toMatchObject({ unit: "wpm", value: 18, count: 17 });
  });

  it("uses the learning home's timezone for --from and --to", async () => {
    const root = await copyExample("morse");
    const config = join(root, "tomewise.json");
    await writeFile(config, JSON.stringify({ ...JSON.parse(await readFile(config, "utf8")), timezone: "Pacific/Auckland" }));

    const result = await json(
      ["query", "morse-code", "--field", "responseTime", "--agg", "count", "--from", "2026-11-09", "--to", "2026-11-09"],
      root,
    );

    expect(result.value).toBe(3);
  });

  it("returns no value when nothing matches", async () => {
    const root = await copyExample("morse");
    const args = ["query", "morse-code", "--field", "responseTime", "--agg", "mean", "--from", "2026-12-01"];

    expect(await json(args, root)).toMatchObject({ value: null, count: 0 });
    expect((await tome(args, root)).stdout).toBe("mean responseTime: none (0 attempts, from 2026-12-01)");
  });

  it("names the known fields when the field is not in the payload schema", async () => {
    const root = await copyExample("morse");

    const result = await tome(["query", "morse-code", "--field", "responseMs", "--agg", "median"], root);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('No field "responseMs" in morse-code attempt payloads');
    expect(result.stderr).toContain("heard, answer, responseTime, wpm");
  });

  it("refuses a numeric aggregate of a field that is not a number", async () => {
    const root = await copyExample("morse");

    const result = await tome(["query", "morse-code", "--field", "heard", "--agg", "mean"], root);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('"heard" is not a number; only count works on it');
  });

  it("rejects unknown filters, aggregates, dates and subjects", async () => {
    const root = await copyExample("morse");
    const base = ["query", "morse-code", "--field", "responseTime"];

    const where = await tome([...base, "--agg", "count", "--where", "colour=red"], root);
    const agg = await tome([...base, "--agg", "sum"], root);
    const date = await tome([...base, "--agg", "count", "--from", "last week"], root);
    const subject = await tome(["query", "spanish", "--field", "responseTime", "--agg", "count"], root);

    expect(where.code).toBe(2);
    expect(where.stderr).toContain('Cannot filter on "colour"');
    expect(where.stderr).toContain("ref, outcome");
    expect(agg.code).toBe(2);
    expect(agg.stderr).toContain("count, mean, median, min, max");
    expect(date.code).toBe(2);
    expect(date.stderr).toContain("YYYY-MM-DD");
    expect(subject.code).toBe(2);
    expect(subject.stderr).toContain('No subject "spanish"');
  });
});
