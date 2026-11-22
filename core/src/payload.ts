import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { type EventKind, eventKinds } from "./events.ts";
import { formatPath, type ValidationIssue } from "./issues.ts";

const scalarTypes = ["number", "integer", "string", "boolean"] as const;
const Unit = z.string().min(1).optional();

const Scalar = z.union([
  z.strictObject({ type: z.enum(scalarTypes), unit: Unit }),
  z.strictObject({ enum: z.array(z.union([z.string(), z.number()])).min(1), unit: Unit }),
]);

const Field = z.union([Scalar, z.strictObject({ type: z.literal("array"), items: Scalar })], {
  error: "Use number, integer, string, boolean, enum, or an array of those, each with an optional unit",
});

type Scalar = z.output<typeof Scalar>;
type Field = z.output<typeof Field>;

const KindSchema = z.strictObject({
  type: z.literal("object").optional(),
  properties: z.record(z.string(), Field),
  required: z.array(z.string()).default([]),
});

export const PayloadSchemaVersion = z.strictObject({
  version: z.int().min(1),
  kinds: z.partialRecord(z.enum(eventKinds, { error: `Unknown kind; use one of ${eventKinds.join(", ")}` }), KindSchema),
});

export type PayloadSchemaVersion = z.output<typeof PayloadSchemaVersion>;

export const PayloadSchemas = z.array(PayloadSchemaVersion).default([]);

export const NO_PAYLOAD: PayloadSchemaVersion[] = [{ version: 1, kinds: {} }];

const extended = "versions are only ever extended";

function extendsField(before: Field, after: Field): boolean {
  if ("items" in before || "items" in after) {
    return "items" in before && "items" in after && extendsField(before.items, after.items);
  }
  if ("enum" in before && "enum" in after) {
    return before.unit === after.unit && before.enum.every((value) => after.enum.includes(value));
  }
  return isDeepStrictEqual(before, after);
}

export function payloadSchemaIssues(versions: PayloadSchemaVersion[], file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const at = (...path: PropertyKey[]) => formatPath(["payloadSchemas", ...path]);
  versions.forEach((current, index) => {
    if (current.version !== index + 1) {
      issues.push({
        file,
        path: at(index, "version"),
        message: `Expected version ${index + 1}; number versions 1, 2, 3 in order`,
      });
    }
    for (const [kind, schema] of Object.entries(current.kinds)) {
      schema.required.forEach((name, r) => {
        if (!(name in schema.properties)) {
          issues.push({
            file,
            path: at(index, "kinds", kind, "required", r),
            message: `Required field "${name}" is not in properties`,
          });
        }
      });
    }
    const previous = versions[index - 1];
    if (!previous) return;
    const was = `from version ${previous.version}; ${extended}`;
    for (const [kind, before] of Object.entries(previous.kinds)) {
      const after = current.kinds[kind as EventKind];
      if (!after) {
        issues.push({ file, path: at(index, "kinds"), message: `Version ${current.version} drops kind "${kind}" ${was}` });
        continue;
      }
      for (const [name, field] of Object.entries(before.properties)) {
        const next = after.properties[name];
        if (!next) {
          issues.push({
            file,
            path: at(index, "kinds", kind, "properties"),
            message: `Version ${current.version} drops field "${name}" ${was}`,
          });
        } else if (!extendsField(field, next)) {
          issues.push({
            file,
            path: at(index, "kinds", kind, "properties", name),
            message: `Version ${current.version} changes field "${name}" ${was}`,
          });
        }
      }
    }
  });
  return issues;
}

function scalarSchema(field: Scalar): z.ZodType {
  if ("enum" in field) {
    return z.literal(field.enum, { error: `Use one of ${field.enum.map((v) => JSON.stringify(v)).join(", ")}` });
  }
  switch (field.type) {
    case "number":
      return z.number();
    case "integer":
      return z.int();
    case "string":
      return z.string();
    case "boolean":
      return z.boolean();
  }
}

function fieldSchema(field: Field): z.ZodType {
  return "items" in field ? z.array(scalarSchema(field.items)) : scalarSchema(field);
}

export function dataSchema(version: PayloadSchemaVersion, kind: EventKind): z.ZodObject {
  const schema = version.kinds[kind];
  if (!schema) return z.strictObject({});
  const shape: Record<string, z.ZodType> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    shape[name] = schema.required.includes(name) ? fieldSchema(field) : fieldSchema(field).optional();
  }
  return z.strictObject(shape);
}
