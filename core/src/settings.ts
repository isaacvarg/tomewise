import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { parseConfig } from "./config.ts";
import { InvalidLearningHomeError, InvalidSettingError, SubjectNotFoundError, UnsupportedFormatVersionError } from "./errors.ts";
import { CONFIG_FILE } from "./find.ts";
import { formatIssue, issuesFrom } from "./issues.ts";
import { readJson } from "./json.ts";
import { subjectOrderIssues } from "./references.ts";
import { AssessmentOverrides, AssessmentSettings, StartMode, SubjectFile, SubjectOrder, ThemeName, TomewiseConfig } from "./schemas.ts";
import { listSubjects, subjectPath } from "./subject.ts";

const settingSchemas = { theme: ThemeName, start: StartMode, subjects: SubjectOrder, assessments: AssessmentSettings } satisfies Record<string, z.ZodType>;

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

function objectMembers(text: string, open: number): { close: number; members: Member[] } {
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
  return { close: at, members };
}

interface Layout {
  indent: string;
  step: string;
  newline: string;
}

function formatValue(value: unknown, layout?: Layout): string {
  if (Array.isArray(value)) return `[${value.map((entry) => formatValue(entry)).join(", ")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  if (!layout) return `{ ${entries.map(([key, entry]) => `${JSON.stringify(key)}: ${formatValue(entry)}`).join(", ")} }`;
  const inner = { ...layout, indent: layout.indent + layout.step };
  const lines = entries.map(([key, entry]) => `${inner.indent}${JSON.stringify(key)}: ${formatValue(entry, inner)}`);
  return `{${layout.newline}${lines.join(`,${layout.newline}`)}${layout.newline}${layout.indent}}`;
}

function lineIndent(text: string, at: number): string {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  let end = start;
  while (text[end] === " " || text[end] === "\t") end++;
  return text.slice(start, end);
}

function indentStep(text: string): string {
  const open = skipSpace(text, 0);
  const first = objectMembers(text, open).members[0];
  const lead = first ? text.slice(open + 1, first.keyStart) : "";
  return lead.includes("\n") ? lead.slice(lead.lastIndexOf("\n") + 1) || "  " : "  ";
}

function setIn(text: string, open: number, [key, ...rest]: [string, ...string[]], value: unknown, step: string): string {
  const { close, members } = objectMembers(text, open);
  const existing = members.findLast((member) => member.key === key);
  if (existing && rest.length > 0 && text[existing.valueStart] === "{") {
    return setIn(text, existing.valueStart, rest as [string, ...string[]], value, step);
  }
  const nested = rest.reduceRight<unknown>((inner, name) => ({ [name]: inner }), value);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const multiline = text.slice(open, close).includes("\n");
  const layout = (indent: string): Layout | undefined => (multiline ? { indent, step, newline } : undefined);

  if (existing) {
    const json = formatValue(nested, layout(lineIndent(text, existing.keyStart)));
    return text.slice(0, existing.valueStart) + json + text.slice(existing.valueEnd);
  }
  const first = members[0];
  if (!first) {
    const indent = lineIndent(text, open) + step;
    const json = formatValue(nested, layout(indent));
    const inner = multiline ? `${newline}${indent}${JSON.stringify(key)}: ${json}${newline}${lineIndent(text, open)}` : ` ${JSON.stringify(key)}: ${json} `;
    return text.slice(0, open + 1) + inner + text.slice(close);
  }
  const lead = text.slice(open + 1, first.keyStart);
  const separator = lead.includes("\n") ? newline + lead.slice(lead.lastIndexOf("\n") + 1) : lead;
  const colon = text.slice(first.keyEnd, first.valueStart);
  const last = members.at(-1)!;
  const json = formatValue(nested, layout(lineIndent(text, first.keyStart)));
  return text.slice(0, last.valueEnd) + `,${separator}${JSON.stringify(key)}${colon}${json}` + text.slice(last.valueEnd);
}

export function setKey(text: string, path: [string, ...string[]], value: unknown): string {
  return setIn(text, skipSpace(text, 0), path, value, indentStep(text));
}

export function setTopLevelKey(text: string, key: string, value: unknown): string {
  return setKey(text, [key], value);
}

function parseJsonFile(file: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InvalidLearningHomeError([{ file, path: "", message: `Invalid JSON: ${(error as Error).message}` }]);
  }
}

async function replaceFile(file: string, text: string): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, file);
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
  const read = parseConfig(parseJsonFile(CONFIG_FILE, before));
  if (read.kind === "too-new") throw new UnsupportedFormatVersionError(read.issue.message);
  if (read.kind === "invalid") throw new InvalidLearningHomeError(read.issues);

  const text = setTopLevelKey(before, key, value);
  const config = TomewiseConfig.parse(JSON.parse(text));
  await replaceFile(file, text);
  return config;
}

export async function writeSubjectAssessments(root: string, id: string, input: unknown): Promise<AssessmentOverrides> {
  const subjects = await listSubjects(root);
  if (!subjects.includes(id)) throw new SubjectNotFoundError(`No subject "${id}" in ${root}. Subjects: ${subjects.join(", ") || "none"}`);
  const name = subjectPath(id, "subject.json");
  const parsed = AssessmentOverrides.safeParse(input);
  if (!parsed.success) {
    throw new InvalidSettingError(issuesFrom(name, parsed.error, ["settings", "assessments"]).map(formatIssue).join("\n"));
  }

  const file = join(root, name);
  const before = await readFile(file, "utf8");
  const current = SubjectFile.safeParse(parseJsonFile(name, before));
  if (!current.success) throw new InvalidLearningHomeError(issuesFrom(name, current.error));

  const text = setKey(before, ["settings", "assessments"], parsed.data);
  SubjectFile.parse(JSON.parse(text));
  await replaceFile(file, text);
  return parsed.data;
}

export async function readSubjectAssessments(root: string, id: string): Promise<AssessmentOverrides> {
  const read = await readJson(join(root, subjectPath(id, "subject.json")));
  if (!read.ok) return {};
  return SubjectFile.safeParse(read.value).data?.settings.assessments ?? {};
}
