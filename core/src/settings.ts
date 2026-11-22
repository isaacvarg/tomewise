import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { parseConfig } from "./config.ts";
import { InvalidLearningHomeError, InvalidSettingError, UnsupportedFormatVersionError } from "./errors.ts";
import { CONFIG_FILE } from "./find.ts";
import { formatIssue, issuesFrom } from "./issues.ts";
import { subjectOrderIssues } from "./references.ts";
import { StartMode, SubjectOrder, ThemeName, TomewiseConfig } from "./schemas.ts";
import { listSubjects } from "./subject.ts";

const settingSchemas = { theme: ThemeName, start: StartMode, subjects: SubjectOrder } satisfies Record<string, z.ZodType>;

export type AppSetting = keyof typeof settingSchemas;

export const APP_SETTINGS = Object.keys(settingSchemas) as AppSetting[];

export function isAppSetting(key: string): key is AppSetting {
  return Object.hasOwn(settingSchemas, key);
}

interface Member {
  keyStart: number;
  keyEnd: number;
  valueStart: number;
  valueEnd: number;
  key: string;
}

const isSpace = (char: string | undefined) => char === " " || char === "\t" || char === "\n" || char === "\r";

function skipSpace(text: string, at: number): number {
  while (isSpace(text[at])) at++;
  return at;
}

function skipString(text: string, at: number): number {
  at++;
  while (text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
  return at + 1;
}

function skipValue(text: string, at: number): number {
  if (text[at] === '"') return skipString(text, at);
  if (text[at] !== "{" && text[at] !== "[") {
    while (at < text.length && !isSpace(text[at]) && !",}]".includes(text[at]!)) at++;
    return at;
  }
  let depth = 0;
  while (true) {
    const char = text[at];
    if (char === '"') {
      at = skipString(text, at);
      continue;
    }
    if (char === "{" || char === "[") depth++;
    if (char === "}" || char === "]") depth--;
    at++;
    if (depth === 0) return at;
  }
}

function topLevelMembers(text: string): { open: number; close: number; members: Member[] } {
  const open = skipSpace(text, 0);
  const members: Member[] = [];
  let at = skipSpace(text, open + 1);
  while (text[at] === '"') {
    const keyStart = at;
    const keyEnd = skipString(text, at);
    const valueStart = skipSpace(text, skipSpace(text, keyEnd) + 1);
    const valueEnd = skipValue(text, valueStart);
    members.push({ keyStart, keyEnd, valueStart, valueEnd, key: JSON.parse(text.slice(keyStart, keyEnd)) as string });
    at = skipSpace(text, valueEnd);
    if (text[at] === ",") at = skipSpace(text, at + 1);
  }
  return { open, close: at, members };
}

function formatValue(value: unknown): string {
  return Array.isArray(value) ? `[${value.map(formatValue).join(", ")}]` : JSON.stringify(value);
}

export function setTopLevelKey(text: string, key: string, value: unknown): string {
  const { open, close, members } = topLevelMembers(text);
  const json = formatValue(value);
  const existing = members.findLast((member) => member.key === key);
  if (existing) return text.slice(0, existing.valueStart) + json + text.slice(existing.valueEnd);
  const first = members[0];
  if (!first) {
    const inner = text.slice(open + 1, close).includes("\n") ? `\n  ${JSON.stringify(key)}: ${json}\n` : ` ${JSON.stringify(key)}: ${json} `;
    return text.slice(0, open + 1) + inner + text.slice(close);
  }
  const lead = text.slice(open + 1, first.keyStart);
  const newline = lead.includes("\r\n") ? "\r\n" : "\n";
  const separator = lead.includes("\n") ? newline + lead.slice(lead.lastIndexOf("\n") + 1) : lead;
  const colon = text.slice(first.keyEnd, first.valueStart);
  const last = members.at(-1)!;
  return text.slice(0, last.valueEnd) + `,${separator}${JSON.stringify(key)}${colon}${json}` + text.slice(last.valueEnd);
}

export async function writeSetting(root: string, key: AppSetting, input: unknown): Promise<TomewiseConfig> {
  const parsed = settingSchemas[key].safeParse(input);
  if (!parsed.success) throw new InvalidSettingError(issuesFrom(CONFIG_FILE, parsed.error, [key]).map(formatIssue).join("\n"));
  const value = parsed.data;
  if (key === "subjects") {
    const issues = subjectOrderIssues(value as string[], await listSubjects(root));
    if (issues.length > 0) throw new InvalidSettingError(issues.map(formatIssue).join("\n"));
  }

  const file = join(root, CONFIG_FILE);
  const before = await readFile(file, "utf8");
  let current: unknown;
  try {
    current = JSON.parse(before);
  } catch (error) {
    throw new InvalidLearningHomeError([{ file: CONFIG_FILE, path: "", message: `Invalid JSON: ${(error as Error).message}` }]);
  }
  const read = parseConfig(current);
  if (read.kind === "too-new") throw new UnsupportedFormatVersionError(read.issue.message);
  if (read.kind === "invalid") throw new InvalidLearningHomeError(read.issues);

  const text = setTopLevelKey(before, key, value);
  const config = TomewiseConfig.parse(JSON.parse(text));
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, file);
  return config;
}
