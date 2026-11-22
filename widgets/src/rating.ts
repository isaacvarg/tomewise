import type { Grade, Outcome } from "./api.ts";

export const GRADES: { grade: Grade; label: string }[] = [
  { grade: 1, label: "Again" },
  { grade: 2, label: "Hard" },
  { grade: 3, label: "Good" },
  { grade: 4, label: "Easy" },
];

export function outcomeOf(grade: Grade): Outcome {
  return grade === 1 ? "wrong" : "correct";
}

export function labelOf(grade: Grade | undefined): string | undefined {
  return GRADES.find((entry) => entry.grade === grade)?.label;
}

export function gradeKey(event: KeyboardEvent): Grade | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  const grade = Number(event.key);
  return grade >= 1 && grade <= 4 ? (grade as Grade) : undefined;
}
