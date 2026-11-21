import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { findLearningHome, LearningHomeNotFoundError } from "@tomewise/core";
import { buildHome, tempDir, writeFiles } from "./helpers.ts";

async function isolatedEnv(extra: Record<string, string> = {}) {
  return { HOME: await tempDir(), ...extra };
}

describe("finding the learning home", () => {
  it("walks up from a nested folder to tomewise.json", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1 } });
    const nested = join(home, "subjects", "morse-code", "lessons");
    await mkdir(nested, { recursive: true });

    const found = await findLearningHome({ cwd: nested, env: await isolatedEnv() });

    expect(found).toBe(home);
  });

  it("falls back to the global config written by init", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1 } });
    const env = await isolatedEnv();
    await writeFiles(env.HOME, { ".config/tomewise/config.json": { learningHome: home } });

    const found = await findLearningHome({ cwd: await tempDir(), env });

    expect(found).toBe(home);
  });

  it("falls back to the TOMEWISE_HOME environment variable", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1 } });

    const found = await findLearningHome({
      cwd: await tempDir(),
      env: await isolatedEnv({ TOMEWISE_HOME: home }),
    });

    expect(found).toBe(home);
  });

  it("prefers the current folder, then the global config, then the environment variable", async () => {
    const nearby = await buildHome({ "tomewise.json": { formatVersion: 1 } });
    const configured = await buildHome({ "tomewise.json": { formatVersion: 1 } });
    const fromEnv = await buildHome({ "tomewise.json": { formatVersion: 1 } });
    const env = await isolatedEnv({ TOMEWISE_HOME: fromEnv });
    await writeFiles(env.HOME, { ".config/tomewise/config.json": { learningHome: configured } });

    expect(await findLearningHome({ cwd: nearby, env })).toBe(nearby);
    expect(await findLearningHome({ cwd: await tempDir(), env })).toBe(configured);
  });

  it("resolves a relative current folder and TOMEWISE_HOME against cwd", async () => {
    const home = await buildHome({ "tomewise.json": { formatVersion: 1 } });
    const nested = join(home, "subjects");
    await mkdir(nested, { recursive: true });
    const elsewhere = await tempDir();
    const previous = process.cwd();
    process.chdir(nested);
    try {
      expect(await findLearningHome({ cwd: ".", env: await isolatedEnv() })).toBe(home);
      expect(
        await findLearningHome({ cwd: elsewhere, env: await isolatedEnv({ TOMEWISE_HOME: relative(elsewhere, home) }) }),
      ).toBe(home);
    } finally {
      process.chdir(previous);
    }
  });

  it("names the global config when it can't be read", async () => {
    const env = await isolatedEnv();
    await writeFiles(env.HOME, { ".config/tomewise/config.json": "{ not json" });

    const search = findLearningHome({ cwd: await tempDir(), env });

    await expect(search).rejects.toThrow(/config\.json: Invalid JSON/);
  });

  it("explains how to create a learning home when none is found", async () => {
    const search = findLearningHome({ cwd: await tempDir(), env: await isolatedEnv() });

    await expect(search).rejects.toBeInstanceOf(LearningHomeNotFoundError);
    await expect(search).rejects.toThrow(/tomewise\.json/);
    await expect(search).rejects.toThrow(/tome init/);
    await expect(search).rejects.toThrow(/TOMEWISE_HOME/);
  });
});
