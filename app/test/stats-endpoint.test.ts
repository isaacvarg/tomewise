import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startTestApp } from "./harness.ts";
import { MORSE, withFixture } from "./stats-fixture.ts";

const NOW = new Date("2026-11-21T12:00:00Z");
const clock = { now: () => NOW, every: () => () => {} };

describe("GET /api/subjects/:subject/stats", () => {
  it("totals all practice and the last 30 days' accuracy", async () => {
    const app = await startTestApp(withFixture, undefined, { clock });

    const response = await app.get("/api/subjects/morse-code/stats");

    expect(response.status).toBe(200);
    expect(response.body.totals).toEqual({ durationMs: 35 * 60_000, sessions: 3, accuracy: 3 / 4 });
  });

  it("draws each chart spec as a per-day series with its unit", async () => {
    const app = await startTestApp(withFixture, undefined, { clock });

    const response = await app.get("/api/subjects/morse-code/stats");

    expect(response.body.charts).toEqual([
      {
        id: "response-time",
        title: "Response time",
        kind: "line",
        measure: "payload",
        aggregate: "median",
        unit: "ms",
        points: [
          { date: "2026-11-19", value: 1100 },
          { date: "2026-11-20", value: null },
          { date: "2026-11-21", value: 1000 },
        ],
      },
      {
        id: "minutes",
        title: "Minutes a day",
        kind: "bar",
        measure: "minutes",
        aggregate: "total",
        unit: "min",
        points: [
          { date: "2026-11-19", value: 10 },
          { date: "2026-11-20", value: 0 },
          { date: "2026-11-21", value: 5 },
        ],
      },
    ]);
  });

  it("gives no charts and no accuracy for a subject with neither", async () => {
    const app = await startTestApp(
      async (root) => {
        await withFixture(root, []);
        await writeFile(join(root, MORSE, "events", "2026-11.jsonl"), "");
      },
      undefined,
      { clock },
    );

    const response = await app.get("/api/subjects/morse-code/stats");

    expect(response.body).toEqual({ totals: { durationMs: 0, sessions: 0, accuracy: null }, charts: [] });
  });

  it("gives 404 for an unknown subject", async () => {
    const app = await startTestApp(undefined, undefined, { clock });

    const response = await app.get("/api/subjects/klingon/stats");

    expect(response.status).toBe(404);
  });
});
