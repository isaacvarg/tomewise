import { join } from "node:path";
import { z } from "zod";
import { CONFIG_FILE } from "./find.ts";
import { issuesFrom, type ValidationIssue } from "./issues.ts";
import { readJson } from "./json.ts";
import { formatVersionTooNew, SUPPORTED_FORMAT_VERSION, TomewiseConfig } from "./schemas.ts";

export type ConfigRead =
  | { kind: "ok"; config: TomewiseConfig }
  | { kind: "too-new"; issue: ValidationIssue }
  | { kind: "invalid"; issues: ValidationIssue[] };

const VersionOnly = z.looseObject({ formatVersion: z.int() });

export async function readConfig(root: string): Promise<ConfigRead> {
  const read = await readJson(join(root, CONFIG_FILE));
  if (!read.ok) return { kind: "invalid", issues: [{ file: CONFIG_FILE, path: "", message: read.message }] };
  return parseConfig(read.value);
}

export function parseConfig(value: unknown): ConfigRead {
  const version = VersionOnly.safeParse(value).data?.formatVersion;
  if (version !== undefined && version > SUPPORTED_FORMAT_VERSION) {
    return { kind: "too-new", issue: { file: CONFIG_FILE, path: "formatVersion", message: formatVersionTooNew(version) } };
  }

  const result = TomewiseConfig.safeParse(value);
  return result.success
    ? { kind: "ok", config: result.data }
    : { kind: "invalid", issues: issuesFrom(CONFIG_FILE, result.error) };
}
