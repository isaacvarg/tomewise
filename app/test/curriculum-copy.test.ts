import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startTestApp } from "./harness.ts";

const MORSE = "subjects/morse-code";
const COPY = `${MORSE}/curriculum.md`;

const markDone = {
  ts: "2026-11-21T09:00:00.000Z",
  subject: "morse-code",
  kind: "milestone.status",
  ref: "milestone:first-five",
  schemaVersion: 2,
  data: { status: "done" },
};

async function vaultOn(root: string, vault: Record<string, unknown> = {}) {
  const file = join(root, "tomewise.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), vault }));
}

const copy = (root: string) => readFile(join(root, COPY), "utf8").catch(() => undefined);

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

describe("curriculum copy in vault mode", () => {
  it("is rewritten after a milestone.status event", async () => {
    const app = await startTestApp((root) => vaultOn(root));

    const response = await app.post(markDone);

    expect(response.status).toBe(201);
    expect(await copy(app.root)).toContain("1. Copy K, M, R, S and U: done\n");
  });

  it("is written when the app starts", async () => {
    const app = await startTestApp((root) => vaultOn(root));

    expect(await copy(app.root)).toContain("1. Copy K, M, R, S and U: current\n");
  });

  it("is written once vault mode is turned on while the app runs", async () => {
    const app = await startTestApp();
    expect(await copy(app.root)).toBeUndefined();

    await vaultOn(app.root);

    await expect.poll(() => copy(app.root), { timeout: 3000, interval: 25 }).toContain("1. Copy K, M, R, S and U: current\n");
  });

  it("is rewritten after curriculum.json changes", async () => {
    const app = await startTestApp((root) => vaultOn(root));
    const file = join(app.root, MORSE, "curriculum.json");
    const curriculum = JSON.parse(await readFile(file, "utf8"));
    curriculum.units[0].milestones[1].title = "Copy P, A, T, I and N";

    await writeFile(file, JSON.stringify(curriculum));

    await expect.poll(() => copy(app.root), { timeout: 3000, interval: 25 }).toContain("2. Copy P, A, T, I and N: upcoming\n");
  });

  it("leaves a learner's curriculum.md alone", async () => {
    const mine = "# My path\n";
    const app = await startTestApp(async (root) => {
      await vaultOn(root);
      await writeFile(join(root, COPY), mine);
    });

    expect((await app.post(markDone)).status).toBe(201);

    expect(await copy(app.root)).toBe(mine);
  });

  it("is never written with vault mode off", async () => {
    const app = await startTestApp((root) => vaultOn(root, { enabled: false }));
    const file = join(app.root, MORSE, "curriculum.json");

    await app.post(markDone);
    await writeFile(file, (await readFile(file, "utf8")).replace("Copy the next five letters", "Copy five more"));
    await settle();

    expect(await readdir(join(app.root, MORSE))).not.toContain("curriculum.md");
  });
});
