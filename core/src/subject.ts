import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Curriculum } from "./curriculum.ts";
import { type Drill, DrillFile, REVIEW_DRILL_ID, reviewDrill } from "./drills.ts";
import { Item } from "./items.ts";
import { formatPath, issuesFrom, type ValidationIssue } from "./issues.ts";
import { readJson } from "./json.ts";
import {
  curriculumReferences,
  duplicateItemIds,
  type Located,
  missingUnlockingLessons,
  unknownDrillTags,
} from "./references.ts";
import { SubjectFile, type TomewiseConfig } from "./schemas.ts";

export const SUBJECTS_DIR = "subjects";

export interface SubjectSettingsResolved {
  timezone: string;
  weekStart: TomewiseConfig["weekStart"];
  minimumSessionSeconds: number;
}

export interface ItemSet {
  id: string;
  file: string;
  items: Item[];
}

export interface Subject {
  id: string;
  name: string;
  settings: SubjectSettingsResolved;
  lessons: string[];
  itemSets: ItemSet[];
  items: Item[];
  drills: Drill[];
  curriculum?: Curriculum;
}

export type SubjectContent = Omit<Subject, "settings"> & { file: SubjectFile };

export interface SubjectRead {
  content?: SubjectContent;
  issues: ValidationIssue[];
}

export function subjectPath(id: string, ...rest: string[]): string {
  return [SUBJECTS_DIR, id, ...rest].join("/");
}

async function entriesIn(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function namesIn(dir: string, extension: string): Promise<string[]> {
  return (await entriesIn(dir))
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name.slice(0, -extension.length))
    .sort();
}

export async function listSubjects(root: string): Promise<string[]> {
  return (await entriesIn(join(root, SUBJECTS_DIR)))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readParsed<T extends z.ZodType>(
  root: string,
  file: string,
  schema: T,
  issues: ValidationIssue[],
  { optional = false } = {},
): Promise<z.output<T> | undefined> {
  const read = await readJson(join(root, file));
  if (!read.ok) {
    if (!(optional && read.missing)) issues.push({ file, path: "", message: read.message });
    return undefined;
  }
  const parsed = schema.safeParse(read.value);
  if (parsed.success) return parsed.data;
  issues.push(...issuesFrom(file, parsed.error));
  return undefined;
}

export function withSettings({ file, ...content }: SubjectContent, config: TomewiseConfig): Subject {
  return {
    ...content,
    settings: {
      timezone: config.timezone,
      weekStart: config.weekStart,
      minimumSessionSeconds: file.settings.minimumSessionSeconds ?? config.minimumSessionSeconds,
    },
  };
}

const ItemList = z.array(z.unknown(), { error: "An item set must be an array of items" });

async function readItemSet(root: string, file: string, issues: ValidationIssue[]): Promise<Located<Item>[]> {
  const list = await readParsed(root, file, ItemList, issues);
  const items: Located<Item>[] = [];
  list?.forEach((raw, index) => {
    const parsed = Item.safeParse(raw);
    if (parsed.success) items.push({ value: parsed.data, file, path: formatPath([index]) });
    else issues.push(...issuesFrom(file, parsed.error, [index]));
  });
  return items;
}

async function readDrills(root: string, id: string, issues: ValidationIssue[]): Promise<Located<Drill>[]> {
  const drills: Located<Drill>[] = [];
  for (const drillId of await namesIn(join(root, SUBJECTS_DIR, id, "drills"), ".json")) {
    const file = subjectPath(id, "drills", `${drillId}.json`);
    if (drillId === REVIEW_DRILL_ID) {
      issues.push({
        file,
        path: "",
        message: `"${REVIEW_DRILL_ID}" is the built-in drill that reviews everything due; rename this file`,
      });
      continue;
    }
    const drill = await readParsed(root, file, DrillFile, issues);
    if (drill) drills.push({ value: { ...drill, id: drillId, builtIn: false }, file, path: "" });
  }
  return drills;
}

export async function readSubject(root: string, id: string): Promise<SubjectRead> {
  const issues: ValidationIssue[] = [];
  const dir = join(root, SUBJECTS_DIR, id);

  const subjectFile = await readParsed(root, subjectPath(id, "subject.json"), SubjectFile, issues);

  const lessons = await namesIn(join(dir, "lessons"), ".html");

  const itemSets: ItemSet[] = [];
  const located: Located<Item>[] = [];
  for (const setId of await namesIn(join(dir, "items"), ".json")) {
    const setFile = subjectPath(id, "items", `${setId}.json`);
    const items = await readItemSet(root, setFile, issues);
    located.push(...items);
    itemSets.push({ id: setId, file: setFile, items: items.map((item) => item.value) });
  }

  const drills = await readDrills(root, id, issues);
  const curriculumFile = subjectPath(id, "curriculum.json");
  const curriculum = await readParsed(root, curriculumFile, Curriculum, issues, { optional: true });
  const lessonsDir = subjectPath(id, "lessons");

  issues.push(
    ...duplicateItemIds(located),
    ...missingUnlockingLessons(located, lessons, lessonsDir),
    ...unknownDrillTags(drills, located),
  );
  if (curriculum) {
    issues.push(...curriculumReferences(curriculum, curriculumFile, lessons, lessonsDir));
  }

  if (!subjectFile) return { issues };
  return {
    content: {
      id,
      name: subjectFile.name,
      file: subjectFile,
      lessons,
      itemSets,
      items: itemSets.flatMap((set) => set.items),
      drills: [reviewDrill, ...drills.map((drill) => drill.value)],
      ...(curriculum && { curriculum }),
    },
    issues,
  };
}
