import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VaultDisabledError } from "./errors.ts";
import { CONFIG_FILE } from "./find.ts";
import type { LearningHome } from "./load.ts";

const MARKER_KEY = "generatedBy";
const MARKER_VALUE = "tomewise";

export const GENERATED_MARKER = `${MARKER_KEY}: ${MARKER_VALUE}`;
export const GENERATED_FILTER = `${MARKER_KEY} == ${JSON.stringify(MARKER_VALUE)}`;
export const BASE_MARKER_LINE = `# ${GENERATED_MARKER}`;

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface WrittenFiles {
  written: string[];
  leftAlone: string[];
}

export type GeneratedStatus = "missing" | "generated" | "learner";

function carriesMarker(path: string, lines: readonly string[]): boolean {
  if (path.endsWith(".base")) return lines[0] === BASE_MARKER_LINE;
  const close = lines.indexOf("---", 1);
  return lines[0] === "---" && close > 0 && lines.slice(1, close).includes(GENERATED_MARKER);
}

export async function generatedStatus(home: LearningHome, path: string): Promise<GeneratedStatus> {
  let text: string;
  try {
    text = await readFile(join(home.root, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((line) => line.trimEnd());
  return carriesMarker(path, lines) ? "generated" : "learner";
}

export async function isGeneratedFile(home: LearningHome, path: string): Promise<boolean> {
  return (await generatedStatus(home, path)) === "generated";
}

export async function writeGeneratedFiles(home: LearningHome, files: readonly GeneratedFile[]): Promise<WrittenFiles> {
  const result: WrittenFiles = { written: [], leftAlone: [] };
  for (const generated of files) {
    if ((await generatedStatus(home, generated.path)) === "learner") {
      result.leftAlone.push(generated.path);
      continue;
    }
    const file = join(home.root, generated.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, generated.content);
    result.written.push(generated.path);
  }
  return result;
}

export function assertVaultMode(home: LearningHome): void {
  if (!home.config.vault.enabled) {
    throw new VaultDisabledError(
      `Vault mode is off in ${join(home.root, CONFIG_FILE)}. Add "vault": {} to turn it on.`,
    );
  }
}
