import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Curriculum } from "./curriculum.ts";
import { DrillFile } from "./drills.ts";
import { EventEnvelope } from "./events.ts";
import { ItemSetFile } from "./items.ts";
import { SubjectFile, SUPPORTED_FORMAT_VERSION, TomewiseConfig } from "./schemas.ts";

export type JsonSchema = z.core.JSONSchema.JSONSchema;

export const JSON_SCHEMA_DIR = `schemas/v${SUPPORTED_FORMAT_VERSION}`;

export const fileSchemas = {
  "tomewise.json": { title: "tomewise.json", schema: TomewiseConfig },
  "subject.json": { title: "subject.json", schema: SubjectFile },
  "item-set.json": { title: "Item set (items/*.json)", schema: ItemSetFile },
  "drill.json": { title: "Drill (drills/*.json)", schema: DrillFile },
  "curriculum.json": { title: "curriculum.json", schema: Curriculum },
  "event.json": { title: "Event envelope (one line of events/*.jsonl)", schema: EventEnvelope },
} satisfies Record<string, { title: string; schema: z.ZodType }>;

export type SchemaFile = keyof typeof fileSchemas;

const machineDefaults = new Set<z.core.$ZodType>([TomewiseConfig.shape.timezone]);

export function jsonSchemas(): Record<SchemaFile, JsonSchema> {
  const entries = Object.entries(fileSchemas).map(([file, { title, schema }]) => {
    const { $schema, ...body } = z.toJSONSchema(schema, {
      target: "draft-2020-12",
      io: "input",
      override: ({ zodSchema, jsonSchema }) => {
        if (machineDefaults.has(zodSchema)) delete jsonSchema.default;
      },
    });
    return [file, { $schema, title: `Tomewise format v${SUPPORTED_FORMAT_VERSION}: ${title}`, ...body }];
  });
  return Object.fromEntries(entries) as Record<SchemaFile, JsonSchema>;
}

export async function writeJsonSchemas(dir: string): Promise<SchemaFile[]> {
  await mkdir(dir, { recursive: true });
  const schemas = jsonSchemas();
  for (const [file, schema] of Object.entries(schemas)) {
    await writeFile(join(dir, file), `${JSON.stringify(schema, null, 2)}\n`);
  }
  return Object.keys(schemas) as SchemaFile[];
}
