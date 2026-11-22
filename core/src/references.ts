import type { Curriculum } from "./curriculum.ts";
import type { Drill } from "./drills.ts";
import type { Item } from "./items.ts";
import { CONFIG_FILE } from "./find.ts";
import type { ValidationIssue } from "./issues.ts";

export interface Located<T> {
  value: T;
  file: string;
  path: string;
}

export function duplicateItemIds(items: Located<Item>[]): ValidationIssue[] {
  const first = new Map<string, Located<Item>>();
  const issues: ValidationIssue[] = [];
  for (const item of items) {
    const seen = first.get(item.value.id);
    if (!seen) first.set(item.value.id, item);
    else
      issues.push({
        file: item.file,
        path: `${item.path}.id`,
        message: `Duplicate item id "${item.value.id}"; first used in ${seen.file} at ${seen.path}.id`,
      });
  }
  return issues;
}

export function missingUnlockingLessons(
  items: Located<Item>[],
  lessons: readonly string[],
  lessonsDir: string,
): ValidationIssue[] {
  return items
    .filter(({ value }) => value.unlockedBy !== undefined && !lessons.includes(value.unlockedBy))
    .map(({ value, file, path }) => ({
      file,
      path: `${path}.unlockedBy`,
      message: `No lesson "${value.unlockedBy}" in ${lessonsDir}`,
    }));
}

export function unknownDrillTags(drills: Located<Drill>[], items: Located<Item>[]): ValidationIssue[] {
  const tags = new Set(items.filter(({ value }) => !value.retired).flatMap(({ value }) => value.tags));
  return drills.flatMap(({ value, file }) =>
    value.select.tags.flatMap((tag, index) =>
      tags.has(tag) ? [] : [{ file, path: `select.tags[${index}]`, message: `No unretired item has tag "${tag}"` }],
    ),
  );
}

export function curriculumReferences(
  curriculum: Curriculum,
  file: string,
  lessons: readonly string[],
  lessonsDir: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firstPath = new Map<string, string>();
  curriculum.units.forEach((unit, u) =>
    unit.milestones.forEach((milestone, m) => {
      const path = `units[${u}].milestones[${m}]`;
      const seen = firstPath.get(milestone.id);
      if (seen) {
        issues.push({
          file,
          path: `${path}.id`,
          message: `Duplicate milestone id "${milestone.id}"; first used at ${seen}.id`,
        });
      } else firstPath.set(milestone.id, path);
      milestone.lessons.forEach((lesson, l) => {
        if (!lessons.includes(lesson)) {
          issues.push({ file, path: `${path}.lessons[${l}]`, message: `No lesson "${lesson}" in ${lessonsDir}` });
        }
      });
    }),
  );
  return issues;
}

export function subjectOrderIssues(order: readonly string[], subjects: readonly string[]): ValidationIssue[] {
  const first = new Map<string, number>();
  return order.flatMap((id, index) => {
    const path = `subjects[${index}]`;
    const seen = first.get(id);
    if (seen !== undefined) return [{ file: CONFIG_FILE, path, message: `Subject "${id}" is already listed at subjects[${seen}]` }];
    first.set(id, index);
    return subjects.includes(id) ? [] : [{ file: CONFIG_FILE, path, message: `No subject "${id}" in subjects/` }];
  });
}
