import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { JSON_SCHEMA_DIR } from "@tomewise/core";
import { fileSchemas, type SchemaFile, writeJsonSchemas } from "../src/json-schemas.ts";
import { snapshot, tempDir } from "./helpers.ts";

const repo = new URL("../../", import.meta.url).pathname;
const published = join(repo, JSON_SCHEMA_DIR);
const morse = join(repo, "examples/morse");
const schemaFiles = Object.keys(fileSchemas) as SchemaFile[];

interface Fixtures {
  valid: Record<string, unknown>;
  invalid: Record<string, unknown>;
  zodOnly: Record<string, unknown>;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fixtures(file: SchemaFile): Promise<Fixtures> {
  return (await readJsonFile(join(repo, "core/test/fixtures/json-schemas", file))) as Fixtures;
}

async function jsonIn(dir: string): Promise<Record<string, unknown>> {
  const entries = await readdir(join(morse, dir));
  const files: Record<string, unknown> = {};
  for (const name of entries.filter((entry) => entry.endsWith(".json")).sort()) {
    files[`${dir}/${name}`] = await readJsonFile(join(morse, dir, name));
  }
  return files;
}

async function eventLines(dir: string): Promise<Record<string, unknown>> {
  const lines: Record<string, unknown> = {};
  for (const name of (await readdir(join(morse, dir))).sort()) {
    const text = await readFile(join(morse, dir, name), "utf8");
    text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .forEach((line, index) => (lines[`${dir}/${name}:${index + 1}`] = JSON.parse(line)));
  }
  return lines;
}

const subject = "subjects/morse-code";

async function morseExamples(file: SchemaFile): Promise<Record<string, unknown>> {
  switch (file) {
    case "tomewise.json":
      return { "tomewise.json": await readJsonFile(join(morse, "tomewise.json")) };
    case "subject.json":
      return { [`${subject}/subject.json`]: await readJsonFile(join(morse, subject, "subject.json")) };
    case "item-set.json":
      return jsonIn(`${subject}/items`);
    case "drill.json":
      return jsonIn(`${subject}/drills`);
    case "curriculum.json":
      return { [`${subject}/curriculum.json`]: await readJsonFile(join(morse, subject, "curriculum.json")) };
    case "event.json":
      return eventLines(`${subject}/events`);
  }
}

async function publishedValidator(file: SchemaFile) {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats.default(ajv);
  return ajv.compile(await readJsonFile(join(published, file)) as object);
}

describe("published JSON Schemas", () => {
  it("are published for every file type and the event envelope, under the format version", async () => {
    expect(JSON_SCHEMA_DIR).toBe("schemas/v1");
    expect((await readdir(published)).sort()).toEqual(
      ["curriculum.json", "drill.json", "event.json", "item-set.json", "subject.json", "tomewise.json"],
    );
  });

  it("match what the Zod schemas generate, byte for byte", async () => {
    const dir = await tempDir();
    await writeJsonSchemas(dir);

    expect(await snapshot(dir)).toEqual(await snapshot(published));
  });

  it("come out identical when regenerated", async () => {
    const first = await tempDir();
    const second = await tempDir();
    await writeJsonSchemas(first);
    await writeJsonSchemas(second);

    expect(await snapshot(second)).toEqual(await snapshot(first));
  });

  describe.each(schemaFiles)("%s", (file) => {
    const zod = fileSchemas[file].schema;

    it("accepts every valid fixture and the Morse example, as Zod does", async () => {
      const validate = await publishedValidator(file);
      const cases = { ...(await fixtures(file)).valid, ...(await morseExamples(file)) };

      const verdicts = Object.entries(cases).map(([name, value]) => [name, zod.safeParse(value).success, validate(value)]);

      expect(verdicts).toEqual(Object.keys(cases).map((name) => [name, true, true]));
    });

    it("rejects every invalid fixture, as Zod does", async () => {
      const validate = await publishedValidator(file);
      const cases = (await fixtures(file)).invalid;

      const verdicts = Object.entries(cases).map(([name, value]) => [name, zod.safeParse(value).success, validate(value)]);

      expect(verdicts).toEqual(Object.keys(cases).map((name) => [name, false, false]));
    });

    it("leaves only the listed checks to Zod", async () => {
      const validate = await publishedValidator(file);
      const cases = (await fixtures(file)).zodOnly;

      const verdicts = Object.entries(cases).map(([name, value]) => [name, zod.safeParse(value).success, validate(value)]);

      expect(verdicts).toEqual(Object.keys(cases).map((name) => [name, false, true]));
    });
  });
});
